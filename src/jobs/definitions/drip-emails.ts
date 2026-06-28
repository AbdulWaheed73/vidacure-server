import { Types } from "mongoose";
import PatientSchema from "../../schemas/patient-schema";
import EmailTemplateSchema from "../../schemas/email-template-schema";
import EmailDispatchSchema from "../../schemas/email-dispatch-schema";
import { sendDripEmail } from "../../services/email-service";
import { renderVidacureEmail } from "../../services/email-renderer";
import { recordEmailSend } from "../../services/email-log-service";
import consentService from "../../services/consent-service";
import { logAuditEvent } from "../../services/audit-service";
import { dripConfig } from "../../config/drip-config";
import { addMonths, subtractDays } from "../../utils/date-utils";
import { EmailTemplateT } from "../../types/email-template-type";
import { PatientT } from "../../types/patient-type";

type LeanTemplate = EmailTemplateT & { _id: Types.ObjectId };

// Only the patient fields the job needs (read-only projection).
type LeanPatient = Pick<
  PatientT,
  | "email"
  | "given_name"
  | "subscription"
  | "prescription"
  | "prescriptionRequests"
  | "emailSequence"
  | "createdAt"
  | "deletionRequestedAt"
  | "anonymizedAt"
  | "deletionCancelledAt"
> & { _id: Types.ObjectId };

/**
 * Daily scan that drives the monthly drip campaign.
 *
 * Correctness lives in the DATA, not in this trigger:
 *  - "due" is computed from emailSequence.anchorDate, so a missed/late run just
 *    catches up next time — nothing is lost.
 *  - EmailDispatch has a unique {patientId, templateId} index, so a patient can
 *    physically never receive the same template twice (crash/restart/double-fire safe).
 *  - "next email" = first active template whose id is NOT in sentTemplateIds, so
 *    admins can reorder/edit/delete templates without misaligning the sequence.
 */
export async function runDripEmails(): Promise<void> {
  const startedAt = new Date();

  if (!dripConfig.enabled) {
    console.log("[drip] DRIP_ENABLED=false — skipping run");
    return;
  }

  console.log(`[drip] run started at ${startedAt.toISOString()}`);

  // Active sequence templates, in order. If there are none, there's nothing to do.
  const templates = (await EmailTemplateSchema.find({ isActive: true })
    .sort({ order: 1 })
    .lean()) as unknown as LeanTemplate[];

  if (templates.length === 0) {
    console.log("[drip] no active email templates — nothing to send");
    return;
  }

  // Active, contactable subscribers who aren't anonymized.
  const patients = (await PatientSchema.find({
    "subscription.status": "active",
    email: { $type: "string", $ne: "" },
    anonymizedAt: null,
  })
    .select(
      "email given_name subscription prescription prescriptionRequests emailSequence createdAt deletionRequestedAt anonymizedAt deletionCancelledAt"
    )
    .lean()) as unknown as LeanPatient[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const patient of patients) {
    if (sent >= dripConfig.batchLimit) {
      console.log(`[drip] batch limit (${dripConfig.batchLimit}) reached — stopping run`);
      break;
    }

    // Skip patients in the deletion grace window (unless they cancelled deletion).
    if (patient.deletionRequestedAt && !patient.deletionCancelledAt) {
      skipped++;
      continue;
    }

    // Lazily initialise the sequence anchor the first time we see this patient.
    let sequence = patient.emailSequence;
    if (!sequence || !sequence.anchorDate) {
      const anchorDate =
        patient.subscription?.currentPeriodStart || patient.createdAt || new Date();
      // Dry run never writes — just compute the anchor in memory.
      if (!dripConfig.dryRun) {
        await PatientSchema.updateOne(
          { _id: patient._id },
          { $set: { "emailSequence.anchorDate": anchorDate, "emailSequence.sentTemplateIds": sequence?.sentTemplateIds || [] } }
        );
      }
      sequence = { anchorDate, sentTemplateIds: sequence?.sentTemplateIds || [] };
    }

    const sentIds = (sequence.sentTemplateIds || []).map((id) => id.toString());
    const sentCount = sentIds.length;

    // Is the next email due yet? offset controls when email #1 goes out.
    const dueDate = addMonths(sequence.anchorDate!, sentCount * dripConfig.intervalMonths + dripConfig.firstEmailOffsetMonths);
    if (startedAt < dueDate) {
      skipped++;
      continue;
    }

    // Next email = first active template the patient hasn't received yet.
    const nextTemplate = templates.find((t) => !sentIds.includes(t._id.toString()));
    if (!nextTemplate) {
      // Sequence complete — patient has received every active template.
      skipped++;
      continue;
    }

    // Defer this cycle if the patient asked for / received a prescription recently.
    if (gotRecentPrescription(patient)) {
      skipped++;
      continue;
    }

    // Read consent once — used to gate (when required) AND recorded on the send log.
    const consent = await consentService.getConsentStatus(
      patient._id.toString(),
      "communication_consent"
    );
    if (dripConfig.requireCommunicationConsent && !consent.hasAcceptedLatest) {
      skipped++;
      continue;
    }

    // Dry run: log what would be sent and move on — no reserve, no send, no writes.
    if (dripConfig.dryRun) {
      console.log(`[drip] DRY RUN — would send "${nextTemplate.title}" to ${patient.email}`);
      sent++;
      continue;
    }

    const result = await reserveAndSend(patient, nextTemplate, consent.hasAcceptedLatest);
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
    else skipped++;
  }

  console.log(
    `[drip] run finished${dripConfig.dryRun ? " (DRY RUN)" : ""} — ${patients.length} active subscribers scanned, ${sent} ${dripConfig.dryRun ? "would send" : "sent"}, ${skipped} skipped, ${failed} failed`
  );
}

/**
 * Reserve the (patient, template) slot, then send. The reservation is written
 * BEFORE the send, so the worst case of a crash mid-send is a *missed* email
 * (retried next run), never a duplicate.
 */
async function reserveAndSend(
  patient: LeanPatient,
  template: LeanTemplate,
  consentGranted: boolean
): Promise<"sent" | "failed" | "skipped"> {
  // Upsert the ledger row. The unique index guarantees at most one row exists.
  const dispatch = await EmailDispatchSchema.findOneAndUpdate(
    { patientId: patient._id, templateId: template._id },
    { $setOnInsert: { patientId: patient._id, templateId: template._id, status: "reserved", attempts: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (dispatch.status === "sent") {
    // Already delivered (e.g. a prior crash after send). Make sure the patient's
    // sequence reflects it so we advance, then move on.
    await PatientSchema.updateOne(
      { _id: patient._id },
      { $addToSet: { "emailSequence.sentTemplateIds": template._id } }
    );
    return "skipped";
  }

  if ((dispatch.attempts || 0) >= dripConfig.maxSendAttempts) {
    // Exhausted retries — leave it for an admin to investigate, don't keep hammering.
    return "skipped";
  }

  try {
    // template.html is the admin-authored content fragment — wrap it in the
    // branded Vidacure shell and personalize ({given_name}) at send time.
    await sendDripEmail({
      to: patient.email,
      subject: template.subject,
      html: renderVidacureEmail(template.html, { givenName: patient.given_name }),
    });

    // Mark sent + advance the patient's sequence (addToSet is idempotent).
    await EmailDispatchSchema.updateOne(
      { _id: dispatch._id },
      { $set: { status: "sent", sentAt: new Date() }, $inc: { attempts: 1 } }
    );
    await PatientSchema.updateOne(
      { _id: patient._id },
      {
        $addToSet: { "emailSequence.sentTemplateIds": template._id },
        $set: { "emailSequence.lastSentAt": new Date() },
      }
    );

    await logAuditEvent({
      userId: patient._id.toString(),
      role: "patient",
      action: "drip_email_sent",
      operation: "CREATE",
      success: true,
      targetId: patient._id.toString(),
      metadata: { templateId: template._id.toString(), templateTitle: template.title, subject: template.subject },
    });

    await recordEmailSend({
      patientId: patient._id,
      patientEmail: patient.email,
      source: "drip",
      templateId: template._id,
      templateTitle: template.title,
      subject: template.subject,
      status: "sent",
      consentGranted,
    });

    return "sent";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await EmailDispatchSchema.updateOne(
      { _id: dispatch._id },
      { $set: { status: "failed", lastError: message }, $inc: { attempts: 1 } }
    );

    await logAuditEvent({
      userId: patient._id.toString(),
      role: "patient",
      action: "drip_email_failed",
      operation: "CREATE",
      success: false,
      targetId: patient._id.toString(),
      metadata: { templateId: template._id.toString(), error: message },
    });

    await recordEmailSend({
      patientId: patient._id,
      patientEmail: patient.email,
      source: "drip",
      templateId: template._id,
      templateTitle: template.title,
      subject: template.subject,
      status: "failed",
      error: message,
      consentGranted,
    });

    console.error(`[drip] send failed for patient ${patient._id} template ${template._id}: ${message}`);
    return "failed";
  }
}

/**
 * True if the patient requested or received a prescription within the configured
 * window — in which case this cycle's email is deferred to next month.
 */
function gotRecentPrescription(patient: LeanPatient): boolean {
  const windowStart = subtractDays(new Date(), dripConfig.prescriptionSkipWindowDays);

  const recentRequest = (patient.prescriptionRequests || []).some((r) => {
    const created = r.createdAt ? new Date(r.createdAt) : null;
    const issued = r.dateIssued ? new Date(r.dateIssued) : null;
    return (created && created >= windowStart) || (issued && issued >= windowStart);
  });

  const recentActivePrescription =
    !!patient.prescription?.updatedAt && new Date(patient.prescription.updatedAt) >= windowStart;

  return recentRequest || recentActivePrescription;
}
