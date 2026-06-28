import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { gzipSync } from "zlib";
import os from "os";
import path from "path";
import { Types } from "mongoose";
import AuditLogSchema from "../../schemas/auditLog-schema";
import { AuditLogT } from "../../types/auditLog-type";
import { auditArchiveConfig } from "../../config/drip-config";
import { startOfUtcDay, utcDateKey } from "../../utils/date-utils";

const run = promisify(execFile);

type AuditLogRow = AuditLogT & { _id: Types.ObjectId };

/**
 * Audit-log cold tiering. Moves audit logs whose whole UTC day is older than
 * `afterDays` (default 90) out of MongoDB into S3 as gzipped NDJSON, partitioned
 * by event date (`dt=YYYY-MM-DD`) for Athena. The S3 archive becomes the sole
 * long-term (5-year, PDL) record once a day is removed from Mongo.
 *
 * Uses the `aws` CLI (no SDK). Registration is guarded in scheduler.ts by
 * `enabled && s3Bucket`.
 *
 * Safety:
 *  - export → confirm upload → only THEN delete (a failed upload throws and
 *    retries next run; nothing is removed from Mongo on failure).
 *  - delete is by the EXACT `_id`s exported — never a broad date `deleteMany`.
 *  - `exportOnly` (default true) skips the delete entirely until you trust it.
 *  - `integrityHash` is preserved in the export so tamper-checks survive the move.
 */
export async function runAuditArchive(): Promise<void> {
  if (!auditArchiveConfig.enabled) {
    console.log("[audit-archive] AUDIT_ARCHIVE_ENABLED=false — skipping");
    return;
  }
  if (!auditArchiveConfig.s3Bucket && !auditArchiveConfig.localDir) {
    console.log("[audit-archive] no destination configured (set AUDIT_ARCHIVE_S3_BUCKET or AUDIT_ARCHIVE_LOCAL_DIR) — skipping");
    return;
  }

  const startedAt = new Date();
  // Only days whose entire span is older than this boundary are eligible.
  const cutoff = new Date(startedAt.getTime() - auditArchiveConfig.afterDays * 24 * 60 * 60 * 1000);

  console.log(
    `[audit-archive] run started at ${startedAt.toISOString()} — exportOnly=${auditArchiveConfig.exportOnly}, cutoff=${cutoff.toISOString()}`
  );

  let daysProcessed = 0;
  let totalExported = 0;
  let totalDeleted = 0;

  // Day cursor advances forward each iteration so the loop progresses whether or
  // not logs are deleted (export-only mode keeps them, so we can't rely on the
  // "oldest" log moving — we step past each day explicitly).
  let cursor: Date | null = null;

  while (daysProcessed < auditArchiveConfig.maxDaysPerRun) {
    // Oldest log at or after the cursor → defines the next day to archive.
    const oldest = await AuditLogSchema.findOne(cursor ? { timestamp: { $gte: cursor } } : {})
      .sort({ timestamp: 1 })
      .select("timestamp")
      .lean<{ timestamp: Date } | null>();

    if (!oldest) break;

    const dayStart = startOfUtcDay(new Date(oldest.timestamp));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Stop once we reach a day that isn't fully aged yet (keeps partitions immutable).
    if (dayEnd > cutoff) break;

    const dateKey = utcDateKey(dayStart);
    const count = await archiveOneDay(dayStart, dayEnd, dateKey);
    totalExported += count.exported;
    totalDeleted += count.deleted;
    daysProcessed++;

    // Step past this day so the next iteration looks strictly forward.
    cursor = dayEnd;
  }

  console.log(
    `[audit-archive] run finished — ${daysProcessed} day(s) processed, ${totalExported} exported, ${totalDeleted} deleted`
  );
}

/**
 * Archive a single UTC day: export → upload → (optionally) delete by exact id.
 * Returns counts. Throws if the upload fails (so the run stops and retries later).
 */
async function archiveOneDay(
  dayStart: Date,
  dayEnd: Date,
  dateKey: string
): Promise<{ exported: number; deleted: number }> {
  const logs = await AuditLogSchema.find({
    timestamp: { $gte: dayStart, $lt: dayEnd },
  }).lean<AuditLogRow[]>();

  if (logs.length === 0) {
    return { exported: 0, deleted: 0 };
  }

  // Flatten each doc to an Athena-friendly JSON line: ObjectIds → strings,
  // timestamp → ISO, metadata → JSON string (queried via json_extract_scalar).
  const ndjson = logs
    .map((log) =>
      JSON.stringify({
        _id: log._id?.toString(),
        userId: log.userId?.toString(),
        role: log.role,
        action: log.action,
        operation: log.operation,
        success: log.success,
        targetId: log.targetId?.toString(),
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        timestamp: log.timestamp ? new Date(log.timestamp).toISOString() : undefined,
        metadata: log.metadata !== undefined ? JSON.stringify(log.metadata) : undefined,
        integrityHash: log.integrityHash,
      })
    )
    .join("\n");

  const gz = gzipSync(Buffer.from(ndjson, "utf8"));
  const relKey = `${auditArchiveConfig.s3Prefix}/dt=${dateKey}/auditlogs.json.gz`;

  // Local mode (testing): write straight to a folder, no temp file, no AWS.
  if (auditArchiveConfig.localDir) {
    const outPath = path.join(auditArchiveConfig.localDir, relKey);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, gz);
    console.log(`[audit-archive] dt=${dateKey} → wrote ${logs.length} log(s) to ${outPath} (local mode)`);

    if (auditArchiveConfig.exportOnly) {
      console.log(`[audit-archive] dt=${dateKey} — exportOnly: would delete ${logs.length} log(s) (leaving Mongo untouched)`);
      return { exported: logs.length, deleted: 0 };
    }
    const localIds = logs.map((l) => l._id);
    const localRes = await AuditLogSchema.deleteMany({ _id: { $in: localIds } });
    console.log(`[audit-archive] dt=${dateKey} — deleted ${localRes.deletedCount} log(s) from MongoDB`);
    return { exported: logs.length, deleted: localRes.deletedCount ?? 0 };
  }

  const tmpFile = path.join(os.tmpdir(), `auditlogs-${dateKey}.json.gz`);
  const s3Uri = `s3://${auditArchiveConfig.s3Bucket}/${relKey}`;

  try {
    await writeFile(tmpFile, gz);

    // Upload (STANDARD_IA, Athena-readable). Throws if it fails → no delete happens.
    await run(
      "aws",
      ["s3", "cp", tmpFile, s3Uri, "--storage-class", auditArchiveConfig.storageClass],
      { maxBuffer: 1024 * 1024 * 16 }
    );

    console.log(`[audit-archive] dt=${dateKey} → uploaded ${logs.length} log(s) to ${s3Uri}`);

    if (auditArchiveConfig.exportOnly) {
      console.log(`[audit-archive] dt=${dateKey} — exportOnly: would delete ${logs.length} log(s) (leaving Mongo untouched)`);
      return { exported: logs.length, deleted: 0 };
    }

    // Delete ONLY the exact docs we just exported.
    const ids = logs.map((l) => l._id);
    const res = await AuditLogSchema.deleteMany({ _id: { $in: ids } });
    console.log(`[audit-archive] dt=${dateKey} — deleted ${res.deletedCount} log(s) from MongoDB`);
    return { exported: logs.length, deleted: res.deletedCount ?? 0 };
  } finally {
    await unlink(tmpFile).catch(() => undefined);
  }
}
