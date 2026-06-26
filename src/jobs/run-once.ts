/**
 * One-shot job runner for testing / manual triggers.
 *
 *   npm run drip:once      → run the drip-email job once and exit
 *   npm run backup:once    → run the Mongo→S3 backup once and exit
 *
 * Connects to MongoDB, runs the chosen job, flushes audit logs, and exits.
 * Honours all the same DRIP_* / BACKUP_* env vars as the scheduler, so you can
 * override cadence for testing, e.g.:
 *   DRIP_FIRST_EMAIL_OFFSET_MONTHS=0 DRIP_REQUIRE_COMMUNICATION_CONSENT=false npm run drip:once
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import databaseConnection from "../utils/database-connection";
import { startAuditFlushTimer, stopAuditFlushTimer, flushAuditBuffer } from "../services/audit-service";
import { runDripEmails } from "./definitions/drip-emails";
import { runMongoBackup } from "./definitions/mongo-backup";

dotenv.config();

const job = (process.argv[2] || "drip").toLowerCase();

async function main(): Promise<void> {
  await databaseConnection();
  startAuditFlushTimer();
  console.log(`[run-once] running "${job}"...`);

  if (job === "drip") {
    await runDripEmails();
  } else if (job === "backup") {
    await runMongoBackup();
  } else {
    console.error(`[run-once] unknown job "${job}" — use "drip" or "backup"`);
    process.exitCode = 1;
  }

  stopAuditFlushTimer();
  await flushAuditBuffer();
  await mongoose.connection.close();
  console.log("[run-once] done.");
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error("[run-once] fatal error:", err);
  process.exit(1);
});
