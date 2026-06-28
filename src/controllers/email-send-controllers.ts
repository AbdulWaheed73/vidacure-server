import express from "express";
import PatientSchema from "../schemas/patient-schema";
import EmailTemplateSchema from "../schemas/email-template-schema";
import EmailDispatchSchema from "../schemas/email-dispatch-schema";
import EmailSendLogSchema from "../schemas/email-send-log-schema";
import { renderVidacureEmail } from "../services/email-renderer";
import { sendDripEmail } from "../services/email-service";
import { recordEmailSend } from "../services/email-log-service";
import consentService from "../services/consent-service";
import { AdminAuthenticatedRequest } from "../middleware/admin-auth-middleware";
import { auditAdminAction } from "../middleware/audit-middleware";
import { EMAIL_SEND_SOURCES } from "../types/email-send-log-type";

/**
 * POST /api/admin/patients/:patientId/send-email
 * Manually send an email to a patient — either an existing template or a custom
 * Tiptap-authored body. Template sends also mark the drip dispatch + sequence so
 * the automated cron will not re-send that template (dedup).
 */
export const sendPatientEmail = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId } = req.params;
    const { mode, templateId, subject, html } = req.body as {
      mode?: string;
      templateId?: string;
      subject?: string;
      html?: string;
    };

    if (mode !== "template" && mode !== "custom") {
      return res.status(400).json({ error: "mode must be 'template' or 'custom'" });
    }

    const patient = await PatientSchema.findById(patientId).select(
      "email given_name anonymizedAt deletionRequestedAt deletionCancelledAt"
    );
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    if (patient.anonymizedAt) return res.status(400).json({ error: "Patient is anonymized" });
    if (patient.deletionRequestedAt && !patient.deletionCancelledAt) {
      return res.status(400).json({ error: "Patient has a pending deletion request" });
    }
    if (!patient.email) return res.status(400).json({ error: "Patient has no email address" });

    // Consent is recorded on the send, but does NOT block a manual admin send.
    const consent = await consentService.getConsentStatus(patientId, "communication_consent");
    const consentGranted = consent.hasAcceptedLatest;

    // Resolve the content + subject for the chosen mode.
    let finalSubject: string;
    let contentHtml: string;
    let templateTitle: string | undefined;
    if (mode === "template") {
      if (!templateId) return res.status(400).json({ error: "templateId is required for template mode" });
      const template = await EmailTemplateSchema.findById(templateId).lean();
      if (!template) return res.status(404).json({ error: "Template not found" });
      finalSubject = template.subject;
      contentHtml = template.html;
      templateTitle = template.title;
    } else {
      if (!subject || !html) return res.status(400).json({ error: "subject and html are required for custom mode" });
      finalSubject = subject;
      contentHtml = html;
    }

    // Send (branded shell + {given_name}).
    const rendered = renderVidacureEmail(contentHtml, { givenName: patient.given_name });
    let status: "sent" | "failed" = "sent";
    let error: string | undefined;
    try {
      await sendDripEmail({ to: patient.email, subject: finalSubject, html: rendered });
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
    }

    // On a successful TEMPLATE send: mark the dispatch + sequence so the cron skips it.
    if (status === "sent" && mode === "template" && templateId) {
      await EmailDispatchSchema.updateOne(
        { patientId, templateId },
        { $set: { status: "sent", sentAt: new Date() }, $setOnInsert: { attempts: 1 } },
        { upsert: true }
      );
      await PatientSchema.updateOne(
        { _id: patientId },
        {
          $addToSet: { "emailSequence.sentTemplateIds": templateId },
          $set: { "emailSequence.lastSentAt": new Date() },
        }
      );
    }

    await recordEmailSend({
      patientId,
      patientEmail: patient.email,
      source: mode === "template" ? "manual_template" : "manual_custom",
      templateId: mode === "template" ? templateId : undefined,
      templateTitle,
      subject: finalSubject,
      status,
      error,
      consentGranted,
      sentByAdminId: req.admin?.userId,
    });

    await auditAdminAction(req, "admin_send_patient_email", "CREATE", status === "sent", patientId, {
      mode,
      templateId,
      subject: finalSubject,
      consentGranted,
    });

    if (status === "failed") {
      return res.status(502).json({ error: `Email send failed: ${error}` });
    }
    return res.json({ message: "Email sent", consentGranted });
  } catch (error: any) {
    await auditAdminAction(req, "admin_send_patient_email", "CREATE", false, req.params?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/admin/patients/:patientId/email-status
 * Active templates flagged sent/not-sent for this patient, plus consent status.
 */
export const getPatientEmailStatus = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId } = req.params;

    const patient = await PatientSchema.findById(patientId).select("emailSequence").lean();
    if (!patient) return res.status(404).json({ error: "Patient not found" });

    const [templates, dispatches, consent] = await Promise.all([
      EmailTemplateSchema.find({ isActive: true }).sort({ order: 1 }).lean(),
      EmailDispatchSchema.find({ patientId, status: "sent" }).select("templateId sentAt").lean(),
      consentService.getConsentStatus(patientId, "communication_consent"),
    ]);

    const sentAtMap = new Map<string, Date>();
    for (const d of dispatches) {
      if (d.templateId) sentAtMap.set(d.templateId.toString(), d.sentAt as Date);
    }
    const sequenceIds = new Set(
      (patient.emailSequence?.sentTemplateIds || []).map((id) => id.toString())
    );

    const result = templates.map((t) => {
      const id = t._id.toString();
      const sent = sentAtMap.has(id) || sequenceIds.has(id);
      return {
        _id: id,
        title: t.title,
        subject: t.subject,
        order: t.order,
        sent,
        sentAt: sentAtMap.get(id) ?? null,
      };
    });

    await auditAdminAction(req, "admin_get_patient_email_status", "READ", true, patientId);

    res.json({ templates: result, communicationConsentGranted: consent.hasAcceptedLatest });
  } catch (error: any) {
    await auditAdminAction(req, "admin_get_patient_email_status", "READ", false, req.params?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/admin/email-log
 * Paginated history of every email sent (drip + manual). Filter by patientId/source.
 */
export const getEmailLog = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "50", 10), 1), 100);
    const { patientId, source } = req.query as { patientId?: string; source?: string };

    const query: Record<string, unknown> = {};
    if (patientId) query.patientId = patientId;
    if (source && (EMAIL_SEND_SOURCES as readonly string[]).includes(source)) query.source = source;

    const [logs, totalCount] = await Promise.all([
      EmailSendLogSchema.find(query)
        .sort({ sentAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("patientId", "name email")
        .lean(),
      EmailSendLogSchema.countDocuments(query),
    ]);

    await auditAdminAction(req, "admin_get_email_log", "READ", true, undefined, { count: logs.length });

    res.json({
      logs,
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (error: any) {
    await auditAdminAction(req, "admin_get_email_log", "READ", false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};
