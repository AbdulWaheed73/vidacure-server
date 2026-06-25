import { Types } from "mongoose";

// --- Single-source enums (schema, validation and TS unions all derive from these) ---
export const ERROR_ORIGINS = ["server", "client"] as const;
export const ERROR_SOURCES = ["api", "web", "app"] as const;
export const ERROR_LEVELS = ["warning", "error", "critical"] as const;
export const ERROR_ACTORS = ["patient", "doctor", "admin", "anonymous"] as const;
export const ERROR_CATEGORIES = [
  "auth",
  "payment",
  "prescription",
  "crash",
  "unhandled",
  "render",
  "network",
  "other",
] as const;

export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];
export type ErrorSource = (typeof ERROR_SOURCES)[number];
export type ErrorLevel = (typeof ERROR_LEVELS)[number];
export type ErrorActor = (typeof ERROR_ACTORS)[number];
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

// Bounded, non-PII context. No free-form map — only known, safe fields.
export type ErrorLogContext = {
  route?: string;
  method?: string;
  statusCode?: number;
  appVersion?: string;
  componentStack?: string;
  details?: string;
};

// Input accepted by recordError() — ids as strings, mapped to ObjectIds internally.
export type RecordErrorInput = {
  origin: ErrorOrigin;
  source: ErrorSource;
  level: ErrorLevel;
  category: ErrorCategory;
  message: string;
  stack?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  actorType: ErrorActor;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  context?: ErrorLogContext;
};

// Shape pushed into the write buffer / persisted (ids as ObjectIds).
export type BufferedErrorEntry = {
  origin: ErrorOrigin;
  source: ErrorSource;
  level: ErrorLevel;
  category: ErrorCategory;
  message: string;
  stack?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  actorType: ErrorActor;
  userId?: Types.ObjectId;
  ipAddress?: string;
  userAgent?: string;
  fingerprint: string;
  context?: ErrorLogContext;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
  timestamp: Date;
};

// Full stored document.
export type ErrorLogT = BufferedErrorEntry;

// Lightweight list projection — ErrorLogT minus the heavy fields (stack, context).
export type ErrorLogListItem = Omit<ErrorLogT, "stack" | "context">;

// Validated body for the public client-error ingest endpoint.
export type ClientErrorPayload = {
  source: Extract<ErrorSource, "web" | "app">;
  level: ErrorLevel;
  category: ErrorCategory;
  message: string;
  stack?: string;
  context?: ErrorLogContext;
};

// Space-separated projection used by the list route AND kept in sync with
// ErrorLogListItem (single source of truth for "what the table needs").
export const ERROR_LOG_LIST_FIELDS =
  "timestamp level category origin source message route statusCode actorType userId resolved fingerprint" as const;
