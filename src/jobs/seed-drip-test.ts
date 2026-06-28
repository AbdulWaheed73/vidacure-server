/**
 * Seed / clean a controlled drip-email test (DEV ONLY).
 *
 *   TEST_EMAIL=you@inbox.com npm run drip:seed         → create 2 test templates + 1 test patient
 *   npm run drip:seed clean                            → remove all the test data
 *
 * The test patient has an active subscription, the given email, and an anchorDate
 * 2 months in the past, so it's immediately "due". Everything created is tagged so
 * `clean` can remove exactly the test rows and nothing else.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import databaseConnection from "../utils/database-connection";
import PatientSchema from "../schemas/patient-schema";
import EmailTemplateSchema from "../schemas/email-template-schema";
import EmailDispatchSchema from "../schemas/email-dispatch-schema";

dotenv.config();

const TEST_SSN_HASH = "TEST_DRIP_PATIENT";          // stable id so seeding is idempotent
const TEST_TEMPLATE_TAG = "[DRIP-TEST]";            // title prefix so cleanup is precise
const mode = (process.argv[2] || "seed").toLowerCase();

async function seed(): Promise<void> {
  const email = process.env.TEST_EMAIL || "drip-test@example.com";

  // Two templates so we can verify the sequence advances one at a time.
  for (const order of [1, 2]) {
    await EmailTemplateSchema.updateOne(
      { title: `${TEST_TEMPLATE_TAG} Month ${order}` },
      {
        $set: {
          subject: `Vidacure test drip #${order}`,
          // {given_name} here proves personalization end-to-end in the delivered email.
          html: `<h2>Hej {given_name}!</h2><p>This is test drip email #${order}. If you can read this — the template was sent AND {given_name} was personalized. 🎉</p>`,
          order,
          isActive: true,
        },
      },
      { upsert: true }
    );
  }

  // Anchor 2 months ago → due immediately even with the default 1-month offset.
  const anchorDate = new Date();
  anchorDate.setMonth(anchorDate.getMonth() - 2);

  await PatientSchema.updateOne(
    { ssnHash: TEST_SSN_HASH },
    {
      $set: {
        name: "Drip Test",
        given_name: "Drip",
        family_name: "Test",
        role: "patient",
        email,
        "subscription.status": "active",
        "subscription.planType": "medical",
        "emailSequence.anchorDate": anchorDate,
        "emailSequence.sentTemplateIds": [],
      },
    },
    { upsert: true }
  );

  console.log(`[seed] test patient (ssnHash=${TEST_SSN_HASH}) email=${email}, 2 templates, anchor=${anchorDate.toISOString()}`);
  console.log(`[seed] next: DRIP_FIRST_EMAIL_OFFSET_MONTHS=0 DRIP_REQUIRE_COMMUNICATION_CONSENT=false npm run drip:once`);
}

async function clean(): Promise<void> {
  const patient = await PatientSchema.findOne({ ssnHash: TEST_SSN_HASH }).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();
  if (patient) {
    await EmailDispatchSchema.deleteMany({ patientId: patient._id });
    await PatientSchema.deleteOne({ _id: patient._id });
  }
  const t = await EmailTemplateSchema.deleteMany({ title: { $regex: `^\\${TEST_TEMPLATE_TAG}` } });
  console.log(`[clean] removed test patient + dispatches + ${t.deletedCount} test template(s)`);
}

async function main(): Promise<void> {
  await databaseConnection();
  if (mode === "clean") await clean();
  else await seed();
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] error:", err);
  process.exit(1);
});
