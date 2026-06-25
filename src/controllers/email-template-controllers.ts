import express from "express";
import EmailTemplateSchema from "../schemas/email-template-schema";
import { AdminAuthenticatedRequest } from "../middleware/admin-auth-middleware";
import { auditAdminAction } from "../middleware/audit-middleware";

/**
 * Admin CRUD for the monthly drip-email "stock". Admins add/edit the pool of
 * emails here; the scheduler delivers each active template to every patient once.
 */

/** POST /api/admin/email-templates — add a new email to the stock */
export const createEmailTemplate = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { title, subject, html, order, isActive } = req.body;

    if (!title || !subject || !html || order === undefined || order === null) {
      return res.status(400).json({ error: "title, subject, html and order are required" });
    }
    if (typeof order !== "number" || Number.isNaN(order)) {
      return res.status(400).json({ error: "order must be a number" });
    }

    const created = await EmailTemplateSchema.create({
      title,
      subject,
      html,
      order,
      isActive: typeof isActive === "boolean" ? isActive : true,
    });

    await auditAdminAction(req, "admin_create_email_template", "CREATE", true, created._id?.toString(), {
      title,
      order,
    });

    res.status(201).json({ template: created });
  } catch (error: any) {
    await auditAdminAction(req, "admin_create_email_template", "CREATE", false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/** GET /api/admin/email-templates — list the stock (sequence order) */
export const listEmailTemplates = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const templates = await EmailTemplateSchema.find({}).sort({ order: 1 }).lean();

    await auditAdminAction(req, "admin_list_email_templates", "READ", true, undefined, { count: templates.length });

    res.json({ templates });
  } catch (error: any) {
    await auditAdminAction(req, "admin_list_email_templates", "READ", false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/** PUT /api/admin/email-templates/:templateId — edit an email in the stock */
export const updateEmailTemplate = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { templateId } = req.params;
    const updates = { ...req.body };

    // Never allow id/timestamps to be overwritten via the body.
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;

    const template = await EmailTemplateSchema.findByIdAndUpdate(
      templateId,
      { $set: updates },
      { new: true }
    );

    if (!template) {
      return res.status(404).json({ error: "Email template not found" });
    }

    await auditAdminAction(req, "admin_update_email_template", "UPDATE", true, templateId);

    res.json({ template });
  } catch (error: any) {
    await auditAdminAction(req, "admin_update_email_template", "UPDATE", false, req.params?.templateId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/admin/email-templates/:templateId — retire an email.
 * Soft-deactivates (isActive:false) by default so already-sent history stays
 * aligned; pass ?hard=true to permanently remove it.
 */
export const deleteEmailTemplate = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { templateId } = req.params;
    const hard = req.query.hard === "true";

    if (hard) {
      const removed = await EmailTemplateSchema.findByIdAndDelete(templateId);
      if (!removed) {
        return res.status(404).json({ error: "Email template not found" });
      }
      await auditAdminAction(req, "admin_delete_email_template", "DELETE", true, templateId, { hard: true });
      return res.json({ message: "Email template permanently deleted" });
    }

    const template = await EmailTemplateSchema.findByIdAndUpdate(
      templateId,
      { $set: { isActive: false } },
      { new: true }
    );
    if (!template) {
      return res.status(404).json({ error: "Email template not found" });
    }

    await auditAdminAction(req, "admin_deactivate_email_template", "DELETE", true, templateId);

    res.json({ message: "Email template deactivated", template });
  } catch (error: any) {
    await auditAdminAction(req, "admin_delete_email_template", "DELETE", false, req.params?.templateId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};
