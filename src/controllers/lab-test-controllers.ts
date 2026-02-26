import { Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import { LAB_TEST_PACKAGES } from "../config/lab-test-packages";
import LabTestOrder from "../schemas/lab-test-order-schema";
import Patient from "../schemas/patient-schema";
import {
  buildFhirOrderBundle,
  placeOrder,
  generateExternalTrackingId,
  parseWebhookPayload,
  parseObservationToResult,
  isGiddirConfigured,
  fetchLabResults,
  fetchLabResultsByTrackingId,
} from "../services/giddir-service";
import { GiddirSubStatus } from "../types/giddir-types";

// ============================================================================
// GET /packages — Return configured test packages
// ============================================================================

export const getTestPackages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.status(200).json({ success: true, packages: LAB_TEST_PACKAGES });

    await req.auditLogger?.logSuccess(
      "lab-test-get-packages",
      "READ",
      undefined,
      { count: LAB_TEST_PACKAGES.length }
    );
  } catch (error) {
    console.error("Error fetching test packages:", error);
    await req.auditLogger?.logFailure("lab-test-get-packages", "READ", error);
    res.status(500).json({ success: false, message: "Failed to fetch test packages" });
  }
};

// ============================================================================
// POST /orders — Place a new lab test order
// ============================================================================

export const placeLabTestOrder = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { testPackageId } = req.body;

    if (!testPackageId) {
      res.status(400).json({ success: false, message: "testPackageId is required" });
      return;
    }

    const testPackage = LAB_TEST_PACKAGES.find((p) => p.id === testPackageId);
    if (!testPackage) {
      res.status(400).json({ success: false, message: "Invalid test package ID" });
      return;
    }

    if (!isGiddirConfigured()) {
      res.status(503).json({ success: false, message: "Lab test service not configured" });
      return;
    }

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Find patient and get SSN data
    const patient = await Patient.findById(userId);
    if (!patient) {
      res.status(404).json({ success: false, message: "Patient not found" });
      return;
    }

    if (!patient.encryptedSsn) {
      res.status(400).json({ success: false, message: "Patient SSN not available" });
      return;
    }

    const trackingId = generateExternalTrackingId();

    // Build FHIR bundle
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

    // Place order with Giddir
    const giddirResult = await placeOrder(bundle);

    if (!giddirResult.success) {
      console.error("Giddir order placement failed:", giddirResult.error);
      await req.auditLogger?.logFailure(
        "lab-test-place-order",
        "CREATE",
        giddirResult.error,
        userId,
        { testPackageId, trackingId }
      );
      res.status(502).json({
        success: false,
        message: "Failed to place order with lab testing service",
      });
      return;
    }

    // Save order to database
    const order = new LabTestOrder({
      patient: userId,
      giddirServiceRequestId: giddirResult.serviceRequestId || undefined,
      externalTrackingId: trackingId,
      testPackage: {
        id: testPackage.id,
        productCode: testPackage.productCode,
        name: testPackage.name,
        nameSv: testPackage.nameSv,
      },
      status: "created",
      statusHistory: [{ status: "created", timestamp: new Date() }],
      results: [],
      orderedAt: new Date(),
    });

    await order.save();

    await req.auditLogger?.logSuccess(
      "lab-test-place-order",
      "CREATE",
      order._id?.toString(),
      { testPackageId, trackingId }
    );

    res.status(201).json({
      success: true,
      order,
      message: "Lab test order placed successfully",
    });
  } catch (error) {
    console.error("Error placing lab test order:", error);
    await req.auditLogger?.logFailure("lab-test-place-order", "CREATE", error);
    res.status(500).json({ success: false, message: "Failed to place lab test order" });
  }
};

// ============================================================================
// Sync order statuses and results from Giddir
// ============================================================================

const TERMINAL_STATUSES: GiddirSubStatus[] = ["signed", "completed-updated", "revoked"];

async function syncPendingOrders(patientId: string): Promise<void> {
  if (!isGiddirConfigured()) return;

  const pendingOrders = await LabTestOrder.find({
    patient: patientId,
    status: { $nin: TERMINAL_STATUSES },
  });

  if (pendingOrders.length === 0) return;

  console.log(`🔄 Syncing ${pendingOrders.length} pending orders from Giddir...`);

  await Promise.all(
    pendingOrders.map(async (order) => {
      try {
        const data = order.giddirServiceRequestId
          ? await fetchLabResults(order.giddirServiceRequestId)
          : await fetchLabResultsByTrackingId(order.externalTrackingId);

        if (!data) return;

        let changed = false;

        if (data.serviceRequestId && !order.giddirServiceRequestId) {
          order.giddirServiceRequestId = data.serviceRequestId;
          changed = true;
        }

        if (data.subStatus && data.subStatus !== order.status) {
          order.status = data.subStatus;
          order.statusHistory.push({
            status: data.subStatus,
            timestamp: new Date(),
          });
          if (TERMINAL_STATUSES.includes(data.subStatus)) {
            order.completedAt = new Date();
          }
          changed = true;
        }

        if (data.observations.length > 0) {
          for (const obs of data.observations) {
            const result = parseObservationToResult(obs);
            const existingIndex = order.results.findIndex(
              (r) => r.observationId === result.observationId
            );
            if (existingIndex >= 0) {
              order.results[existingIndex] = result;
            } else {
              order.results.push(result);
            }
          }
          changed = true;
        }

        if (changed) {
          await order.save();
          console.log(`✅ Synced order ${order.externalTrackingId}: status=${order.status}, results=${order.results.length}`);
        }
      } catch (error) {
        console.error(`Error syncing order ${order.externalTrackingId}:`, error);
      }
    })
  );
}

// ============================================================================
// GET /orders — List patient's orders (with Giddir sync)
// ============================================================================

export const getOrders = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Fire off Giddir sync in the background — don't block the response
    syncPendingOrders(userId).catch((err) =>
      console.error("Background Giddir sync error:", err)
    );

    const statusFilter = req.query.status as string | undefined;
    const query: Record<string, unknown> = { patient: userId };
    if (statusFilter) {
      query.status = statusFilter;
    }

    const orders = await LabTestOrder.find(query)
      .sort({ orderedAt: -1 })
      .lean();

    await req.auditLogger?.logSuccess(
      "lab-test-get-orders",
      "READ",
      userId,
      { count: orders.length, statusFilter }
    );

    res.status(200).json({ success: true, orders });
  } catch (error) {
    console.error("Error fetching lab test orders:", error);
    await req.auditLogger?.logFailure("lab-test-get-orders", "READ", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

// ============================================================================
// GET /orders/:orderId — Single order with full results
// ============================================================================

export const getOrderById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { orderId } = req.params;

    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Sync this specific order from Giddir if it's not terminal
    const orderDoc = await LabTestOrder.findOne({
      _id: orderId,
      patient: userId,
    });

    if (!orderDoc) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    if (!TERMINAL_STATUSES.includes(orderDoc.status as GiddirSubStatus) && isGiddirConfigured()) {
      try {
        let data = orderDoc.giddirServiceRequestId
          ? await fetchLabResults(orderDoc.giddirServiceRequestId)
          : null;
        if (!data) {
          data = await fetchLabResultsByTrackingId(orderDoc.externalTrackingId);
        }

        if (data) {
          if (data.serviceRequestId && !orderDoc.giddirServiceRequestId) {
            orderDoc.giddirServiceRequestId = data.serviceRequestId;
          }
          if (data.subStatus && data.subStatus !== orderDoc.status) {
            orderDoc.status = data.subStatus;
            orderDoc.statusHistory.push({ status: data.subStatus, timestamp: new Date() });
            if (TERMINAL_STATUSES.includes(data.subStatus)) {
              orderDoc.completedAt = new Date();
            }
          }
          if (data.observations.length > 0) {
            for (const obs of data.observations) {
              const result = parseObservationToResult(obs);
              const existingIndex = orderDoc.results.findIndex(
                (r) => r.observationId === result.observationId
              );
              if (existingIndex >= 0) {
                orderDoc.results[existingIndex] = result;
              } else {
                orderDoc.results.push(result);
              }
            }
          }
          await orderDoc.save();
        }
      } catch (syncError) {
        console.error("Error syncing single order:", syncError);
      }
    }

    const order = orderDoc.toObject();

    await req.auditLogger?.logSuccess(
      "lab-test-get-order",
      "READ",
      orderId
    );

    res.status(200).json({ success: true, order });
  } catch (error) {
    console.error("Error fetching lab test order:", error);
    await req.auditLogger?.logFailure("lab-test-get-order", "READ", error);
    res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
};

// ============================================================================
// GET /patient/:patientId/lab-orders — Doctor endpoint
// ============================================================================

export const getPatientLabOrders = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const doctorId = req.user?.userId;
    const { patientId } = req.params;

    if (!doctorId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Verify the patient is assigned to this doctor
    const patient = await Patient.findById(patientId).lean();
    if (!patient) {
      res.status(404).json({ success: false, message: "Patient not found" });
      return;
    }

    if (patient.doctor?.toString() !== doctorId) {
      res.status(403).json({
        success: false,
        message: "Not authorized to view this patient's lab orders",
      });
      return;
    }

    const orders = await LabTestOrder.find({ patient: patientId })
      .sort({ orderedAt: -1 })
      .lean();

    await req.auditLogger?.logSuccess(
      "lab-test-get-patient-orders",
      "READ",
      patientId,
      { doctorId, count: orders.length }
    );

    res.status(200).json({ success: true, orders });
  } catch (error) {
    console.error("Error fetching patient lab orders:", error);
    await req.auditLogger?.logFailure("lab-test-get-patient-orders", "READ", error);
    res.status(500).json({ success: false, message: "Failed to fetch patient lab orders" });
  }
};

// ============================================================================
// POST /webhook — Giddir webhook handler (no auth middleware)
// ============================================================================

export const handleGiddirWebhook = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify x-api-key header (Giddir sends this with webhook requests)
    const webhookApiKey = process.env.GIDDIR_WEBHOOK_API_KEY;
    if (webhookApiKey) {
      const receivedKey = req.headers["x-api-key"] as string;
      if (receivedKey !== webhookApiKey) {
        console.warn("Giddir webhook: invalid x-api-key");
        res.status(401).json({ error: "Invalid API key" });
        return;
      }
    }

    // Parse raw body if it's a Buffer (from express.raw middleware)
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      body = JSON.parse(body.toString("utf-8"));
    }

    console.log("Giddir webhook received:", JSON.stringify(body).substring(0, 500));

    const parsed = parseWebhookPayload(body);

    if (!parsed.trackingId && !parsed.serviceRequestId) {
      console.warn("Giddir webhook: no tracking ID or service request ID found");
      res.status(200).json({ received: true });
      return;
    }

    // Find the matching order
    let order = null;
    if (parsed.trackingId) {
      order = await LabTestOrder.findOne({
        externalTrackingId: parsed.trackingId,
      });
    }
    if (!order && parsed.serviceRequestId) {
      order = await LabTestOrder.findOne({
        giddirServiceRequestId: parsed.serviceRequestId,
      });
    }

    if (!order) {
      console.warn(
        "Giddir webhook: no matching order found for",
        parsed.trackingId || parsed.serviceRequestId
      );
      res.status(200).json({ received: true });
      return;
    }

    // Update Giddir service request ID if we got it for the first time
    if (parsed.serviceRequestId && !order.giddirServiceRequestId) {
      order.giddirServiceRequestId = parsed.serviceRequestId;
    }

    // Update status
    if (parsed.subStatus) {
      order.status = parsed.subStatus;
      order.statusHistory.push({
        status: parsed.subStatus,
        timestamp: new Date(),
      });

      // Mark completed if terminal status
      if (parsed.subStatus === "signed" || parsed.subStatus === "completed-updated") {
        order.completedAt = new Date();
      }
    }

    // Parse and upsert results from observations
    if (parsed.observations.length > 0) {
      for (const obs of parsed.observations) {
        const result = parseObservationToResult(obs);

        // Upsert: update existing result or add new one
        const existingIndex = order.results.findIndex(
          (r) => r.observationId === result.observationId
        );
        if (existingIndex >= 0) {
          order.results[existingIndex] = result;
        } else {
          order.results.push(result);
        }
      }
    }

    await order.save();

    console.log(
      `✅ Giddir webhook processed: order ${order.externalTrackingId}, status: ${order.status}, results: ${order.results.length}`
    );

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Giddir webhook processing error:", error);
    // Always return 200 to prevent webhook retries
    res.status(200).json({ received: true });
  }
};
