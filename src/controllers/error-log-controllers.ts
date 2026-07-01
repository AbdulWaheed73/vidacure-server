import express from "express";
import { Types, FilterQuery } from "mongoose";
import ErrorLog from "../schemas/error-log-schema";
import { AdminAuthenticatedRequest } from "../middleware/admin-auth-middleware";
import { auditAdminAction } from "../middleware/audit-middleware";
import { resolveUserNames } from "../utils/resolve-user-names";
import {
  recordError,
  extractIpAddress,
  parseUserAgent,
} from "../services/error-log-service";
import { verifyAppJWT } from "../services/auth-service";
import {
  ERROR_LOG_LIST_FIELDS,
  ERROR_LEVELS,
  ERROR_CATEGORIES,
  ErrorLogT,
  ErrorLogListItem,
  ErrorLogContext,
  ErrorActor,
  ErrorLevel,
  ErrorCategory,
  ClientErrorPayload,
} from "../types/error-log-types";

type ErrorLogListRow = ErrorLogListItem & { _id: Types.ObjectId };

const isLevel = (v: unknown): v is ErrorLevel =>
  typeof v === "string" && (ERROR_LEVELS as readonly string[]).includes(v);
const isCategory = (v: unknown): v is ErrorCategory =>
  typeof v === "string" && (ERROR_CATEGORIES as readonly string[]).includes(v);

// Shared filter builder — used by the list AND the export endpoints (DRY).
function buildErrorLogFilter(query: Record<string, unknown>): FilterQuery<ErrorLogT> {
  const filter: FilterQuery<ErrorLogT> = {};
  const { level, category, origin, resolved, dateFrom, dateTo } = query;
  if (isLevel(level)) filter.level = level;
  if (isCategory(category)) filter.category = category;
  if (origin === "server" || origin === "client") filter.origin = origin;
  if (resolved === "true") filter.resolved = true;
  else if (resolved === "false") filter.resolved = false;
  if (typeof dateFrom === "string" || typeof dateTo === "string") {
    filter.timestamp = {};
    if (typeof dateFrom === "string") filter.timestamp.$gte = new Date(dateFrom);
    if (typeof dateTo === "string") filter.timestamp.$lte = new Date(dateTo);
  }
  return filter;
}

// ---- Admin: list (lightweight, DB-projected — no stack/context shipped) ----
export const getErrorLogs = async (req: AdminAuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = (page - 1) * limit;

    const filter = buildErrorLogFilter(req.query);

    const [logs, totalCount] = await Promise.all([
      ErrorLog.find(filter)
        .select(ERROR_LOG_LIST_FIELDS)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean<ErrorLogListRow[]>(),
      ErrorLog.countDocuments(filter),
    ]);

    const nameMap = await resolveUserNames(logs.map((l) => l.userId));
    const enriched = logs.map((l) => ({
      ...l,
      userName: l.userId ? nameMap[String(l.userId)] : undefined,
    }));

    await auditAdminAction(req, "admin_view_error_logs", "READ", true, undefined, {
      page,
      filters: Object.keys(filter),
    });
    res.json({
      logs: enriched,
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (error) {
    await auditAdminAction(req, "admin_view_error_logs", "READ", false, undefined, undefined, error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch error logs" });
  }
};

// ---- Admin: export ALL matching logs with FULL details (stack + context) ----
const MAX_EXPORT = 10000;

export const exportErrorLogs = async (req: AdminAuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const filter = buildErrorLogFilter(req.query);

    // Full documents (no projection) so the export contains everything needed to fix them.
    const logs = await ErrorLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(MAX_EXPORT)
      .lean<(ErrorLogT & { _id: Types.ObjectId })[]>();

    const nameMap = await resolveUserNames(logs.flatMap((l) => [l.userId, l.resolvedBy]));
    const enriched = logs.map((l) => ({
      ...l,
      userName: l.userId ? nameMap[String(l.userId)] : undefined,
      resolvedByName: l.resolvedBy ? nameMap[String(l.resolvedBy)] : undefined,
    }));

    await auditAdminAction(req, "admin_export_error_logs", "READ", true, undefined, {
      count: enriched.length,
      capped: enriched.length >= MAX_EXPORT,
    });
    res.json({
      count: enriched.length,
      capped: enriched.length >= MAX_EXPORT,
      exportedAt: new Date().toISOString(),
      logs: enriched,
    });
  } catch (error) {
    await auditAdminAction(req, "admin_export_error_logs", "READ", false, undefined, undefined, error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to export error logs" });
  }
};

// ---- Admin: single record detail (heavy fields fetched on demand) ----
export const getErrorLog = async (req: AdminAuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid error log id" });
      return;
    }
    const log = await ErrorLog.findById(id).lean<ErrorLogT & { _id: Types.ObjectId }>();
    if (!log) {
      res.status(404).json({ error: "Error log not found" });
      return;
    }
    const nameMap = await resolveUserNames([log.userId, log.resolvedBy]);
    await auditAdminAction(req, "admin_view_error_log_detail", "READ", true, id);
    res.json({
      ...log,
      userName: log.userId ? nameMap[String(log.userId)] : undefined,
      resolvedByName: log.resolvedBy ? nameMap[String(log.resolvedBy)] : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch error log" });
  }
};

// ---- Admin: summary (aggregated, tiny payload) ----
export const getErrorLogSummary = async (req: AdminAuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const [topErrors, unresolvedByLevel] = await Promise.all([
      ErrorLog.aggregate([
        { $match: { timestamp: { $gte: since } } },
        {
          $group: {
            _id: "$fingerprint",
            count: { $sum: 1 },
            message: { $first: "$message" },
            category: { $first: "$category" },
            level: { $first: "$level" },
            lastSeen: { $max: "$timestamp" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, fingerprint: "$_id", count: 1, message: 1, category: 1, level: 1, lastSeen: 1 } },
      ]),
      ErrorLog.aggregate([
        { $match: { resolved: false } },
        { $group: { _id: "$level", count: { $sum: 1 } } },
        { $project: { _id: 0, level: "$_id", count: 1 } },
      ]),
    ]);

    await auditAdminAction(req, "admin_view_error_summary", "READ", true);
    res.json({
      period: { from: since.toISOString(), to: new Date().toISOString() },
      topErrors,
      unresolvedByLevel,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch error summary" });
  }
};

// ---- Admin: resolve / un-resolve (partial $set write) ----
export const resolveErrorLog = async (req: AdminAuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "Invalid error log id" });
      return;
    }
    const setResolved = (req.body as { resolved?: boolean } | undefined)?.resolved !== false;
    const adminId = req.admin?.userId;

    const update = setResolved
      ? {
          $set: {
            resolved: true,
            resolvedAt: new Date(),
            ...(adminId && Types.ObjectId.isValid(adminId)
              ? { resolvedBy: new Types.ObjectId(adminId) }
              : {}),
          },
        }
      : { $set: { resolved: false }, $unset: { resolvedAt: "", resolvedBy: "" } };

    const result = await ErrorLog.updateOne({ _id: id }, update);
    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Error log not found" });
      return;
    }
    await auditAdminAction(req, "admin_resolve_error_log", "UPDATE", true, id, { resolved: setResolved });
    res.json({ success: true, resolved: setResolved });
  } catch (error) {
    await auditAdminAction(req, "admin_resolve_error_log", "UPDATE", false, req.params.id, undefined, error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update error log" });
  }
};

// ---- Public: client crash ingest (web + mobile) ----
function sanitizeContext(raw: unknown): ErrorLogContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  const out: ErrorLogContext = {};
  if (typeof c.route === "string") out.route = c.route.slice(0, 300);
  if (typeof c.method === "string") out.method = c.method.slice(0, 10);
  if (typeof c.statusCode === "number") out.statusCode = c.statusCode;
  if (typeof c.appVersion === "string") out.appVersion = c.appVersion.slice(0, 50);
  if (typeof c.componentStack === "string") out.componentStack = c.componentStack.slice(0, 4000);
  if (typeof c.details === "string") out.details = c.details.slice(0, 1000);
  return Object.keys(out).length > 0 ? out : undefined;
}

export const ingestClientError = (req: express.Request, res: express.Response): void => {
  try {
    const body = req.body as Partial<ClientErrorPayload> | undefined;
    if (!body || (body.source !== "web" && body.source !== "app")) {
      res.status(400).json({ error: "Invalid source" });
      return;
    }
    if (!isLevel(body.level) || !isCategory(body.category)) {
      res.status(400).json({ error: "Invalid level or category" });
      return;
    }
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      res.status(400).json({ error: "Missing message" });
      return;
    }

    // Best-effort actor: cookie (web) or Bearer (app). Never required.
    let actorType: ErrorActor = "anonymous";
    let userId: string | undefined;
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.app_token;
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const token = cookieToken || bearer;
    if (token) {
      const claims = verifyAppJWT(token);
      if (claims) {
        userId = claims.userId;
        actorType = claims.role === "doctor" ? "doctor" : claims.role === "admin" ? "admin" : "patient";
      }
    }

    const context = sanitizeContext(body.context);
    recordError({
      origin: "client",
      source: body.source,
      level: body.level,
      category: body.category,
      message: body.message,
      stack: typeof body.stack === "string" ? body.stack : undefined,
      context,
      route: context?.route,
      actorType,
      userId,
      ipAddress: extractIpAddress(req),
      userAgent: parseUserAgent(req.headers["user-agent"]),
    });
    res.status(204).end();
  } catch {
    // Ingest must never surface errors to the client.
    res.status(204).end();
  }
};
