/**
 * Configuration for the monthly drip-email campaign and the scheduler process.
 * Everything is env-driven so behaviour can be tuned without code changes.
 */

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true";
};

export const dripConfig = {
  // Master switch — set DRIP_ENABLED=false to pause all sends without removing the cron.
  enabled: bool("DRIP_ENABLED", true),

  // Dry run (testing): run the full eligibility logic and log who WOULD get which
  // email, but send nothing and write nothing (no Resend call, no DB mutations).
  dryRun: bool("DRIP_DRY_RUN", false),

  // Cron expression + timezone for the daily scan (pinned TZ avoids DST drift).
  cron: process.env.DRIP_CRON || "0 9 * * *", // every day 09:00
  timezone: process.env.DRIP_TIMEZONE || "Europe/Stockholm",

  // Months between emails, and how long after the anchor the FIRST email goes out.
  // offset = 1 → first email one month after subscribing.
  intervalMonths: num("DRIP_INTERVAL_MONTHS", 1),
  firstEmailOffsetMonths: num("DRIP_FIRST_EMAIL_OFFSET_MONTHS", 1),

  // If the patient requested/received a prescription within this many days, the
  // month's email is skipped and naturally deferred to the next cycle.
  prescriptionSkipWindowDays: num("DRIP_PRESCRIPTION_SKIP_WINDOW_DAYS", 30),

  // GDPR: only email patients who granted communication_consent. Default true (safe).
  requireCommunicationConsent: bool("DRIP_REQUIRE_COMMUNICATION_CONSENT", true),

  // Automatic retry cap for a failing send before we stop trying that template.
  maxSendAttempts: num("DRIP_MAX_SEND_ATTEMPTS", 3),

  // Safety cap: max emails sent per run, to stay within Resend rate limits.
  batchLimit: num("DRIP_BATCH_LIMIT", 500),
};

export const backupConfig = {
  // The backup cron only registers if a destination bucket is configured.
  s3Bucket: process.env.BACKUP_S3_BUCKET || "",
  // Date-partitioned: <prefix>/dt=YYYY-MM-DD/full.gz — keeps the 15-day lifecycle rule clean.
  s3Prefix: process.env.BACKUP_S3_PREFIX || "mongo/dump",
  cron: process.env.BACKUP_CRON || "0 2 * * *", // every day 02:00
  timezone: process.env.BACKUP_TIMEZONE || "Europe/Stockholm",
  mongoUri: process.env.MONGODB_URI || "",
};

export const auditArchiveConfig = {
  // Master switch — OFF by default. Won't touch anything until you flip this AND set a bucket.
  enabled: bool("AUDIT_ARCHIVE_ENABLED", false),

  // Safety: export to S3 but DO NOT delete from MongoDB. Keep this true until you've
  // verified the S3 files look right, then set false to enable the delete step.
  exportOnly: bool("AUDIT_ARCHIVE_EXPORT_ONLY", true),

  // Logs whose whole UTC day is older than this many days get archived + (optionally) removed.
  afterDays: num("AUDIT_ARCHIVE_AFTER_DAYS", 90),

  // Falls back to the DR backup bucket if a dedicated one isn't set.
  s3Bucket: process.env.AUDIT_ARCHIVE_S3_BUCKET || process.env.BACKUP_S3_BUCKET || "",
  s3Prefix: process.env.AUDIT_ARCHIVE_S3_PREFIX || "audit-archive",

  // Infrequent Access: cheaper, still Athena-queryable (Glacier would need a restore first).
  storageClass: process.env.AUDIT_ARCHIVE_S3_STORAGE_CLASS || "STANDARD_IA",

  // LOCAL TESTING ONLY: if set, write archive files to this local folder instead of
  // uploading to S3 (no AWS needed). e.g. AUDIT_ARCHIVE_LOCAL_DIR=./tmp/audit-archive
  localDir: process.env.AUDIT_ARCHIVE_LOCAL_DIR || "",

  cron: process.env.AUDIT_ARCHIVE_CRON || "30 2 * * *", // 02:30, after the backup
  timezone: process.env.AUDIT_ARCHIVE_TIMEZONE || "Europe/Stockholm",

  // Bound on days processed per run (protects the initial backlog from a runaway).
  maxDaysPerRun: num("AUDIT_ARCHIVE_MAX_DAYS_PER_RUN", 40),

  mongoUri: process.env.MONGODB_URI || "",
};
