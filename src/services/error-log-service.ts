import crypto from "crypto";
import type { Request } from "express";
import { Types } from "mongoose";
import ErrorLog from "../schemas/error-log-schema";
import { createBufferedWriter } from "../utils/buffered-writer";
import { extractIpAddress } from "./audit-service";
import { parseUserAgent } from "../utils/user-agent-parser";
import {
  RecordErrorInput,
  BufferedErrorEntry,
  ErrorActor,
} from "../types/error-log-types";

const MESSAGE_MAX = 2000;
const STACK_MAX = 8000;
const FLUSH_INTERVAL_MS = 5000;

// Single buffered writer instance for error logs (non-blocking, batched persistence).
const writer = createBufferedWriter<BufferedErrorEntry>({
  label: "ErrorLog",
  intervalMs: FLUSH_INTERVAL_MS,
  persist: async (batch) => {
    await ErrorLog.insertMany(batch, { ordered: false });
  },
});

export function startErrorLogWriter(): void {
  writer.start();
}

export function stopErrorLogWriter(): void {
  writer.stop();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

function toObjectId(id?: string): Types.ObjectId | undefined {
  if (id && Types.ObjectId.isValid(id)) return new Types.ObjectId(id);
  return undefined;
}

/**
 * Stable grouping key: category + route + a normalised message (ids/numbers stripped),
 * so the same error from different requests collapses to one fingerprint.
 */
function computeFingerprint(category: string, route: string | undefined, message: string): string {
  const normalisedMessage = message
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, "*") // ids / hashes / hex
    .replace(/\d+/g, "*"); // remaining numbers
  const payload = `${category}|${route ?? ""}|${normalisedMessage}`;
  return crypto.createHash("sha1").update(payload).digest("hex");
}

/**
 * Records an error/crash. O(1), never throws, never awaited on the request path.
 */
export function recordError(input: RecordErrorInput): void {
  try {
    const message = truncate(input.message || "Unknown error", MESSAGE_MAX);
    const entry: BufferedErrorEntry = {
      origin: input.origin,
      source: input.source,
      level: input.level,
      category: input.category,
      message,
      stack: input.stack ? truncate(input.stack, STACK_MAX) : undefined,
      route: input.route,
      method: input.method,
      statusCode: input.statusCode,
      actorType: input.actorType,
      userId: toObjectId(input.userId),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      fingerprint: computeFingerprint(input.category, input.route, message),
      context: input.context,
      resolved: false,
      timestamp: new Date(),
    };
    writer.push(entry);
  } catch (error) {
    // Logging must never break the request path.
    console.error(
      "Failed to record error log entry:",
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// An Express request that may carry a regular user or admin identity.
type ActorRequest = Request & {
  user?: { userId: string; role: string };
  admin?: { userId: string; role: string };
};

/**
 * Best-effort actor resolution from an authenticated request (admin takes precedence).
 */
export function resolveActor(req: ActorRequest): { actorType: ErrorActor; userId?: string } {
  if (req.admin?.userId) return { actorType: "admin", userId: req.admin.userId };
  if (req.user?.userId) {
    const actorType: ErrorActor = req.user.role === "doctor" ? "doctor" : "patient";
    return { actorType, userId: req.user.userId };
  }
  return { actorType: "anonymous" };
}

// Re-export so capture middleware / ingest can build IP + UA the same way audit does.
export { extractIpAddress, parseUserAgent };
