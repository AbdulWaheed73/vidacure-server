/**
 * Standalone scheduler process — runs as its OWN PM2 app (vidacure-scheduler,
 * fork mode, instances: 1), separate from the Express API. It only connects to
 * MongoDB and registers cron jobs; it does NOT load the Express app or open a port.
 *
 * Why a dedicated process: isolation (a heavy backup/email batch can't degrade
 * the API), independent restarts, and a single instance means the cron fires once.
 */
import cron from "node-cron";
import dotenv from "dotenv";
import databaseConnection from "../utils/database-connection";
import { startAuditFlushTimer, stopAuditFlushTimer, flushAuditBuffer } from "../services/audit-service";
import { runDripEmails } from "./definitions/drip-emails";
import { runMongoBackup } from "./definitions/mongo-backup";
import { runAuditArchive } from "./definitions/audit-archive";
import { dripConfig, backupConfig, auditArchiveConfig } from "../config/drip-config";

dotenv.config();

// A run-guard so an overrunning job can't overlap itself on the next tick.
const running = new Set<string>();

async function runGuarded(name: string, fn: () => Promise<void>): Promise<void> {
  if (running.has(name)) {
    console.warn(`[scheduler] "${name}" still running from previous tick — skipping`);
    return;
  }
  running.add(name);
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] job "${name}" threw: ${message}`);
  } finally {
    running.delete(name);
  }
}

async function main(): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[scheduler] RESEND_API_KEY is not set — drip emails will fail to send");
  }

  await databaseConnection();
  startAuditFlushTimer();
  console.log("[scheduler] connected to MongoDB");

  // Drip emails — daily scan, monthly cadence enforced per-patient in the job.
  cron.schedule(dripConfig.cron, () => runGuarded("drip-emails", runDripEmails), {
    timezone: dripConfig.timezone,
  });
  console.log(`[scheduler] drip-emails scheduled "${dripConfig.cron}" (${dripConfig.timezone}), enabled=${dripConfig.enabled}`);

  // Mongo → S3 backup — only if a destination bucket is configured.
  if (backupConfig.s3Bucket) {
    cron.schedule(backupConfig.cron, () => runGuarded("mongo-backup", runMongoBackup), {
      timezone: backupConfig.timezone,
    });
    console.log(`[scheduler] mongo-backup scheduled "${backupConfig.cron}" (${backupConfig.timezone}) → ${backupConfig.s3Bucket}`);
  } else {
    console.log("[scheduler] mongo-backup disabled (BACKUP_S3_BUCKET not set)");
  }

  // Audit-log archive → S3 (Athena cold tier). Only if enabled AND a bucket is set.
  if (auditArchiveConfig.enabled && auditArchiveConfig.s3Bucket) {
    cron.schedule(auditArchiveConfig.cron, () => runGuarded("audit-archive", runAuditArchive), {
      timezone: auditArchiveConfig.timezone,
    });
    console.log(
      `[scheduler] audit-archive scheduled "${auditArchiveConfig.cron}" (${auditArchiveConfig.timezone}) → ${auditArchiveConfig.s3Bucket}, exportOnly=${auditArchiveConfig.exportOnly}`
    );
  } else {
    console.log("[scheduler] audit-archive disabled (AUDIT_ARCHIVE_ENABLED=false or no bucket)");
  }

  console.log("🕒 Scheduler is up.");
}

// Flush buffered audit entries before the process exits.
const shutdown = async (signal: string) => {
  console.log(`[scheduler] received ${signal} — shutting down`);
  stopAuditFlushTimer();
  await flushAuditBuffer();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  console.error("[scheduler] fatal startup error:", err);
  process.exit(1);
});
