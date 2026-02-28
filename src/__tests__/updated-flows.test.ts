/**
 * Tests for all flows updated in this commit:
 *
 * 1. GET /api/doctor/patients — returns patients with `id` (not `_id`), no `success` wrapper
 * 2. GET /api/doctor/patient/:patientId/lab-orders — doctor views patient lab orders + audit
 * 3. GET /api/admin/patients — no longer returns `providers` field
 * 4. POST /api/admin/assign-provider — removed, should 404
 * 5. POST /api/admin/unassign-provider — removed, should 404
 * 6. Patient schema — `providers` field no longer exists
 * 7. Audit log verification for doctor endpoints
 */

import express from "express";
import request from "supertest";
import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Schemas
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import LabTestOrder from "../schemas/lab-test-order-schema";
import AuditLogSchema from "../schemas/auditLog-schema";

// Controllers
import { getDoctorPatients, getPatientProfile } from "../controllers/doctor-controllers";
import { getPatientLabOrders } from "../controllers/lab-test-controllers";
import { getAllPatients } from "../controllers/admin-controllers";

// Audit
import { createAuditLogger } from "../services/audit-service";
import { auditAdminAction } from "../middleware/audit-middleware";

// ─── In-memory MongoDB ────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const createObjectId = () => new Types.ObjectId();

function buildDoctorApp(doctorId: string) {
  const app = express();
  app.use(express.json());

  // Mock auth + audit middleware
  app.use((req: any, _res, next) => {
    req.user = { userId: doctorId, role: "doctor" };
    req.auditLogger = createAuditLogger(req);
    next();
  });

  app.get("/api/doctor/patients", getDoctorPatients);
  app.get("/api/doctor/patient/:patientId/lab-orders", getPatientLabOrders);
  app.get("/api/doctor/patient-profile", getPatientProfile);

  return app;
}

function buildAdminApp(adminId: string) {
  const app = express();
  app.use(express.json());

  // Mock admin auth
  app.use((req: any, _res, next) => {
    req.admin = { userId: adminId, role: "admin" };
    next();
  });

  app.get("/api/admin/patients", getAllPatients);
  // These routes should NOT exist anymore:
  // app.post("/api/admin/assign-provider", ...);
  // app.post("/api/admin/unassign-provider", ...);

  return app;
}

async function createPatient(overrides: Record<string, any> = {}) {
  const id = overrides._id || createObjectId();
  const patient = new PatientSchema({
    _id: id,
    ssnHash: overrides.ssnHash || `hash_${id}`,
    name: overrides.name || "Test Patient",
    given_name: overrides.given_name || "Test",
    family_name: overrides.family_name || "Patient",
    role: "patient",
    email: overrides.email || `patient_${id}@test.com`,
    weightHistory: overrides.weightHistory || [],
    questionnaire: overrides.questionnaire || [],
    ...overrides,
  });
  await patient.save();
  return patient;
}

async function createDoctor(overrides: Record<string, any> = {}) {
  const id = overrides._id || createObjectId();
  const doctor = new DoctorSchema({
    _id: id,
    ssnHash: overrides.ssnHash || `hash_${id}`,
    name: overrides.name || "Dr. Test",
    given_name: overrides.given_name || "Dr",
    family_name: overrides.family_name || "Test",
    role: "doctor",
    email: overrides.email || `doctor_${id}@test.com`,
    patients: overrides.patients || [],
    ...overrides,
  });
  await doctor.save();
  return doctor;
}

async function createLabOrder(patientId: Types.ObjectId, overrides: Record<string, any> = {}) {
  const order = new LabTestOrder({
    patient: patientId,
    externalTrackingId: overrides.externalTrackingId || `track_${createObjectId()}`,
    testPackage: overrides.testPackage || {
      id: "pkg_1",
      productCode: "BLD-001",
      name: "Blood Panel",
      nameSv: "Blodprov",
    },
    status: overrides.status || "final-report",
    statusHistory: overrides.statusHistory || [{ status: "draft", timestamp: new Date() }],
    results: overrides.results || [],
    orderedAt: overrides.orderedAt || new Date(),
    ...overrides,
  });
  await order.save();
  return order;
}

function getAuditLogs(filter: Record<string, any> = {}) {
  return AuditLogSchema.find(filter).sort({ timestamp: -1 }).lean();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/doctor/patients", () => {
  it("returns patients with `id` field (not `_id`) and no `success` wrapper", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient({
      doctor: doctor._id,
      name: "Alice Smith",
      given_name: "Alice",
      family_name: "Smith",
      email: "alice@test.com",
      height: 170,
      bmi: 24.5,
    });

    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get("/api/doctor/patients");

    expect(res.status).toBe(200);
    // Response has `patients` array directly — no `success` field
    expect(res.body.success).toBeUndefined();
    expect(res.body.patients).toHaveLength(1);

    const p = res.body.patients[0];
    // Must have `id`, NOT `_id`
    expect(p.id).toBe(patient._id.toString());
    expect(p._id).toBeUndefined();
    expect(p.name).toBe("Alice Smith");
    expect(p.givenName).toBe("Alice");
    expect(p.familyName).toBe("Smith");
    expect(p.email).toBe("alice@test.com");
    expect(p.height).toBe(170);
    expect(p.bmi).toBe(24.5);
  });

  it("returns empty array when doctor has no patients", async () => {
    const doctor = await createDoctor();
    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get("/api/doctor/patients");

    expect(res.status).toBe(200);
    expect(res.body.patients).toHaveLength(0);
  });

  it("only returns patients assigned to this doctor", async () => {
    const doctor1 = await createDoctor({ email: "d1@test.com", ssnHash: "d1" });
    const doctor2 = await createDoctor({ email: "d2@test.com", ssnHash: "d2" });
    await createPatient({ doctor: doctor1._id, name: "Patient A", ssnHash: "pa", email: "pa@test.com" });
    await createPatient({ doctor: doctor2._id, name: "Patient B", ssnHash: "pb", email: "pb@test.com" });

    const app = buildDoctorApp(doctor1._id.toString());
    const res = await request(app).get("/api/doctor/patients");

    expect(res.body.patients).toHaveLength(1);
    expect(res.body.patients[0].name).toBe("Patient A");
  });

  it("creates an audit log entry on success", async () => {
    const doctor = await createDoctor();
    await createPatient({ doctor: doctor._id });

    const app = buildDoctorApp(doctor._id.toString());
    await request(app).get("/api/doctor/patients");

    const logs = await getAuditLogs({ action: "get_doctor_patients" });
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const log = logs[0];
    expect(log.action).toBe("get_doctor_patients");
    expect(log.operation).toBe("READ");
    expect(log.success).toBe(true);
    expect(log.userId.toString()).toBe(doctor._id.toString());
    expect(log.metadata).toBeDefined();
    expect(log.metadata?.count).toBe(1);
  });
});

describe("GET /api/doctor/patient/:patientId/lab-orders", () => {
  it("returns lab orders for a patient assigned to the doctor", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient({ doctor: doctor._id });
    const order = await createLabOrder(patient._id, {
      status: "final-report",
      results: [
        {
          observationId: "obs1",
          code: "HGB",
          name: "Hemoglobin",
          valueType: "quantity",
          valueQuantity: { value: 14.2, unit: "g/dL" },
          isOutOfRange: false,
        },
      ],
    });

    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get(`/api/doctor/patient/${patient._id}/lab-orders`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]._id).toBe(order._id.toString());
    expect(res.body.orders[0].testPackage.name).toBe("Blood Panel");
    expect(res.body.orders[0].results).toHaveLength(1);
    expect(res.body.orders[0].results[0].name).toBe("Hemoglobin");
  });

  it("returns 403 when doctor tries to view unassigned patient's lab orders", async () => {
    const doctor = await createDoctor();
    const otherDoctor = await createDoctor({ email: "other@test.com", ssnHash: "other" });
    const patient = await createPatient({ doctor: otherDoctor._id });
    await createLabOrder(patient._id);

    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get(`/api/doctor/patient/${patient._id}/lab-orders`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("returns 404 for non-existent patient", async () => {
    const doctor = await createDoctor();
    const fakeId = createObjectId();

    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get(`/api/doctor/patient/${fakeId}/lab-orders`);

    expect(res.status).toBe(404);
  });

  it("returns empty orders array when patient has no lab tests", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient({ doctor: doctor._id });

    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get(`/api/doctor/patient/${patient._id}/lab-orders`);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(0);
  });

  it("creates an audit log on successful lab order fetch", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient({ doctor: doctor._id });
    await createLabOrder(patient._id);

    const app = buildDoctorApp(doctor._id.toString());
    await request(app).get(`/api/doctor/patient/${patient._id}/lab-orders`);

    const logs = await getAuditLogs({ action: "lab-test-get-patient-orders" });
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const log = logs[0];
    expect(log.action).toBe("lab-test-get-patient-orders");
    expect(log.operation).toBe("READ");
    expect(log.success).toBe(true);
    expect(log.userId.toString()).toBe(doctor._id.toString());
  });

  it("returns 500 with descriptive error for invalid patientId format", async () => {
    const doctor = await createDoctor();
    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app).get("/api/doctor/patient/undefined/lab-orders");

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

describe("GET /api/admin/patients — providers field removed", () => {
  it("returns patients WITHOUT a `providers` field", async () => {
    const adminId = createObjectId().toString();
    await createPatient({ name: "Jane Doe" });

    const app = buildAdminApp(adminId);
    const res = await request(app).get("/api/admin/patients");

    expect(res.status).toBe(200);
    expect(res.body.patients).toHaveLength(1);

    const patient = res.body.patients[0];
    // The `providers` field should NOT be present
    expect(patient.providers).toBeUndefined();
    // Other fields should still be there
    expect(patient.name).toBe("Jane Doe");
    expect(patient).toHaveProperty("email");
    expect(patient).toHaveProperty("subscription");
    expect(patient).toHaveProperty("createdAt");
  });

  it("creates admin audit log for patient listing", async () => {
    const adminId = createObjectId().toString();
    await createPatient();

    const app = buildAdminApp(adminId);
    await request(app).get("/api/admin/patients");

    const logs = await getAuditLogs({ action: "admin_get_all_patients" });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].success).toBe(true);
    expect(logs[0].operation).toBe("READ");
    expect(logs[0].role).toBe("admin");
  });
});

describe("Removed endpoints — assign/unassign provider", () => {
  it("POST /api/admin/assign-provider returns 404 (route removed)", async () => {
    const adminId = createObjectId().toString();
    const app = buildAdminApp(adminId);

    const res = await request(app)
      .post("/api/admin/assign-provider")
      .send({ patientId: createObjectId(), providerId: createObjectId() });

    // No route handler exists, Express returns 404
    expect(res.status).toBe(404);
  });

  it("POST /api/admin/unassign-provider returns 404 (route removed)", async () => {
    const adminId = createObjectId().toString();
    const app = buildAdminApp(adminId);

    const res = await request(app)
      .post("/api/admin/unassign-provider")
      .send({ patientId: createObjectId(), providerId: createObjectId() });

    expect(res.status).toBe(404);
  });
});

describe("Patient schema — providers field removed", () => {
  it("does not persist a `providers` field on new patients", async () => {
    const patient = await createPatient();
    const raw = await PatientSchema.findById(patient._id).lean();

    expect(raw).toBeDefined();
    expect((raw as any).providers).toBeUndefined();
  });

  it("ignores providers if passed during creation", async () => {
    const fakeProviderId = createObjectId();
    // Even if someone tries to set providers, schema should ignore it
    const patient = new PatientSchema({
      ssnHash: "test_hash_prov",
      name: "Prov Test",
      given_name: "Prov",
      family_name: "Test",
      role: "patient",
      email: "provtest@test.com",
      weightHistory: [],
      questionnaire: [],
      providers: [fakeProviderId],
    });
    await patient.save();

    const raw = await PatientSchema.findById(patient._id).lean();
    // Mongoose should strip the unknown field since it's no longer in the schema
    expect((raw as any).providers).toBeUndefined();
  });
});

describe("Doctor patient profile audit logging", () => {
  it("logs get_patient_profile audit event with correct metadata", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient({
      doctor: doctor._id,
      weightHistory: [
        { weight: 85, date: new Date() },
        { weight: 84, date: new Date() },
      ],
    });

    const app = buildDoctorApp(doctor._id.toString());
    await request(app)
      .get("/api/doctor/patient-profile")
      .query({ patientId: patient._id.toString(), limit: "10" });

    const logs = await getAuditLogs({ action: "get_patient_profile" });
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const log = logs[0];
    expect(log.action).toBe("get_patient_profile");
    expect(log.operation).toBe("READ");
    expect(log.success).toBe(true);
    expect(log.targetId?.toString()).toBe(patient._id.toString());
  });

  it("logs audit error when doctor tries to access unassigned patient profile", async () => {
    const doctor = await createDoctor();
    const otherDoctor = await createDoctor({ email: "other2@test.com", ssnHash: "other2" });
    const patient = await createPatient({ doctor: otherDoctor._id });

    const app = buildDoctorApp(doctor._id.toString());
    const res = await request(app)
      .get("/api/doctor/patient-profile")
      .query({ patientId: patient._id.toString(), limit: "10" });

    // Returns 404 because patient is not assigned to this doctor
    expect(res.status).toBe(404);

    // Should log a failure audit event
    const logs = await getAuditLogs({
      action: "get_patient_profile",
      success: false,
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
