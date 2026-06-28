import { execFile } from "child_process";
import { promisify } from "util";
import { unlink } from "fs/promises";
import os from "os";
import path from "path";
import { backupConfig } from "../../config/drip-config";
import { utcDateKey } from "../../utils/date-utils";

const run = promisify(execFile);

/**
 * Nightly MongoDB → S3 backup.
 *
 * Uses the `mongodump` and `aws` CLIs (must be installed on the EC2 host) rather
 * than an SDK, so it adds no npm dependencies. The job only runs if
 * BACKUP_S3_BUCKET is configured (registration is guarded in scheduler.ts).
 *
 * Flow: mongodump --gzip --archive → upload to S3 → delete the local temp file.
 */
export async function runMongoBackup(): Promise<void> {
  if (!backupConfig.s3Bucket) {
    console.log("[backup] BACKUP_S3_BUCKET not set — skipping");
    return;
  }
  if (!backupConfig.mongoUri) {
    console.error("[backup] MONGODB_URI not set — cannot run backup");
    return;
  }

  // Date-partitioned key: <prefix>/dt=YYYY-MM-DD/full.gz — one full snapshot per day,
  // so the 20-day S3 lifecycle rule evicts the oldest cleanly (rolling window).
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const tmpFile = path.join(os.tmpdir(), `vidacure-${stamp}.gz`);
  const s3Key = `${backupConfig.s3Prefix}/dt=${utcDateKey(now)}/full.gz`;
  const s3Uri = `s3://${backupConfig.s3Bucket}/${s3Key}`;

  console.log(`[backup] run started at ${now.toISOString()} → ${s3Uri}`);

  try {
    // 1. Dump the whole database to a single gzipped archive file.
    await run("mongodump", [`--uri=${backupConfig.mongoUri}`, `--archive=${tmpFile}`, "--gzip"], {
      maxBuffer: 1024 * 1024 * 64,
    });

    // 2. Upload to S3 (bucket should enforce SSE-KMS + lifecycle retention).
    await run("aws", ["s3", "cp", tmpFile, s3Uri], { maxBuffer: 1024 * 1024 * 16 });

    console.log(`[backup] uploaded ${s3Uri}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backup] FAILED: ${message}`);
    // Re-throw so a failure alert / monitoring can pick it up.
    throw err;
  } finally {
    // 3. Always clean up the local temp file.
    await unlink(tmpFile).catch(() => undefined);
  }
}
