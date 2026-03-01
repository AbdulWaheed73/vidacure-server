import Patient from "../schemas/patient-schema";
import LabTestOrder from "../schemas/lab-test-order-schema";
import { LAB_TEST_PACKAGES } from "../config/lab-test-packages";
import {
  buildFhirOrderBundle,
  placeOrder,
  generateExternalTrackingId,
  isGiddirConfigured,
} from "./giddir-service";

/**
 * Place a Giddir lab test order for a patient.
 * Extracted from the controller so it can be called by both the REST endpoint
 * and the Stripe webhook handler.
 *
 * If `existingOrderId` is provided, the existing LabTestOrder document is
 * updated with the Giddir tracking data instead of creating a new one.
 */
export async function placeLabTestOrderForPatient(
  patientId: string,
  testPackageId: string,
  existingOrderId?: string
) {
  const testPackage = LAB_TEST_PACKAGES.find((p) => p.id === testPackageId);
  if (!testPackage) {
    throw new Error(`Invalid test package ID: ${testPackageId}`);
  }

  if (!isGiddirConfigured()) {
    throw new Error("Lab test service (Giddir) is not configured");
  }

  const patient = await Patient.findById(patientId);
  if (!patient) {
    throw new Error(`Patient not found: ${patientId}`);
  }

  if (!patient.encryptedSsn) {
    throw new Error("Patient SSN not available");
  }

  const trackingId = generateExternalTrackingId();

  const bundle = buildFhirOrderBundle(
    {
      encryptedSsn: patient.encryptedSsn,
      name: patient.name,
      given_name: patient.given_name,
      family_name: patient.family_name,
      email: patient.email,
      gender: patient.gender,
      dateOfBirth: patient.dateOfBirth
        ? new Date(patient.dateOfBirth).toISOString().split("T")[0]
        : undefined,
    },
    testPackage.productCode,
    trackingId
  );

  const giddirResult = await placeOrder(bundle);

  if (!giddirResult.success) {
    throw new Error(
      `Giddir order placement failed: ${giddirResult.error || "unknown error"}`
    );
  }

  // Update existing order or create a new one
  if (existingOrderId) {
    const order = await LabTestOrder.findById(existingOrderId);
    if (!order) {
      throw new Error(`Existing order not found: ${existingOrderId}`);
    }
    order.externalTrackingId = trackingId;
    order.giddirServiceRequestId = giddirResult.serviceRequestId || undefined;
    order.status = "created";
    order.statusHistory.push({ status: "created", timestamp: new Date() });
    order.orderedAt = new Date();
    await order.save();
    return order;
  }

  // Create new order document
  const order = new LabTestOrder({
    patient: patientId,
    giddirServiceRequestId: giddirResult.serviceRequestId || undefined,
    externalTrackingId: trackingId,
    testPackage: {
      id: testPackage.id,
      productCode: testPackage.productCode,
      name: testPackage.name,
      nameSv: testPackage.nameSv,
    },
    status: "created",
    paymentStatus: "paid",
    statusHistory: [{ status: "created", timestamp: new Date() }],
    results: [],
    orderedAt: new Date(),
  });

  await order.save();
  return order;
}
