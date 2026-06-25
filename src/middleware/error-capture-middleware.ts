import { Request, Response, NextFunction } from "express";
import {
  recordError,
  resolveActor,
  extractIpAddress,
  parseUserAgent,
} from "../services/error-log-service";
import { ErrorLevel } from "../types/error-log-types";

/**
 * Mounted early (before routes). After each response is sent, records any 5xx as an
 * error log. Runs on `res.on("finish")` so it adds ZERO latency to the request.
 * Uses `req.path` (no query string) so OAuth code/state/tokens are never stored.
 */
export function errorCaptureMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    if (res.statusCode < 500) return;
    try {
      const { actorType, userId } = resolveActor(req);
      const level: ErrorLevel = res.statusCode >= 500 ? "error" : "warning";
      recordError({
        origin: "server",
        source: "api",
        level,
        category: "other",
        message: `HTTP ${res.statusCode} on ${req.method} ${req.path}`,
        route: req.path,
        method: req.method,
        statusCode: res.statusCode,
        actorType,
        userId,
        ipAddress: extractIpAddress(req),
        userAgent: parseUserAgent(req.headers["user-agent"]),
      });
    } catch {
      // Never let logging affect the response lifecycle.
    }
  });
  next();
}

/**
 * Global Express error handler (mounted AFTER all routes). Records unhandled throws as
 * critical, then returns a generic 500. First centralised error handler in the app.
 */
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const { actorType, userId } = resolveActor(req);
    recordError({
      origin: "server",
      source: "api",
      level: "critical",
      category: "unhandled",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      route: req.path,
      method: req.method,
      statusCode: 500,
      actorType,
      userId,
      ipAddress: extractIpAddress(req),
      userAgent: parseUserAgent(req.headers["user-agent"]),
    });
  } catch {
    // swallow
  }

  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}
