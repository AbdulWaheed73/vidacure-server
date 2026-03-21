import { Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import { LAB_TEST_PACKAGES } from "../config/lab-test-packages";
import { DRAFT_ORDER_TTL_MS } from "../config/time-constants";
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
  fetchRequisitionList,
} from "../services/giddir-service";
import stripeService from "../services/stripe-service";
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

    // Save Giddir Patient ID if not already set
    if (giddirResult.giddirPatientId && !patient.giddirPatientId) {
      patient.giddirPatientId = giddirResult.giddirPatientId;
      await patient.save();
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
// POST /create-checkout-session — Create Stripe Checkout for a lab test
// ============================================================================

const getFrontendUrl = (): string => {
  const url = process.env.FRONTEND_URL;
  return url?.replace(/\/+$/, "") || "";
};

export const createLabTestCheckoutSession = async (
  req: AuthenticatedRequest,
  res: Response
) => {
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

    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const patient = await Patient.findById(userId);
    if (!patient) {
      res.status(404).json({ success: false, message: "Patient not found" });
      return;
    }

    // Get or create Stripe customer
    let customerId = patient.subscription?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        patient.email || `patient-${patient._id}@vidacure.com`,
        patient.name,
        { userId: userId.toString() }
      );
      customerId = customer.id;

      if (!patient.subscription) {
        patient.subscription = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: "",
          stripePriceId: "",
          stripeProductId: "",
          status: "incomplete",
          planType: "lifestyle",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        };
      } else {
        patient.subscription.stripeCustomerId = customerId;
      }
      await patient.save();
    }

    // Create a pending LabTestOrder (auto-deleted after 24h if payment never completes)
    const order = new LabTestOrder({
      patient: userId,
      testPackage: {
        id: testPackage.id,
        productCode: testPackage.productCode,
        name: testPackage.name,
        nameSv: testPackage.nameSv,
      },
      status: "draft",
      paymentStatus: "pending_payment",
      statusHistory: [{ status: "draft", timestamp: new Date() }],
      results: [],
      draftExpiresAt: new Date(Date.now() + DRAFT_ORDER_TTL_MS),
    });

    await order.save();

    const frontendUrl = getFrontendUrl();
    if (!frontendUrl) {
      res.status(500).json({ success: false, message: "Server configuration error" });
      return;
    }

    const successUrl = `${frontendUrl}/lab-tests/payment-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/lab-tests/payment-canceled`;

    const session = await stripeService.createLabTestCheckoutSession({
      customerId,
      priceAmountOre: testPackage.priceAmountOre,
      priceCurrency: testPackage.priceCurrency,
      productName: testPackage.name,
      successUrl,
      cancelUrl,
      metadata: {
        type: "lab_test",
        userId: userId.toString(),
        testPackageId: testPackage.id,
        orderId: order._id!.toString(),
      },
    });

    // Store checkout session ID on the order
    order.stripeCheckoutSessionId = session.id;
    await order.save();

    await req.auditLogger?.logSuccess(
      "lab-test-create-checkout",
      "CREATE",
      order._id?.toString(),
      { testPackageId, sessionId: session.id }
    );

    res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
      orderId: order._id!.toString(),
    });
  } catch (error) {
    console.error("Error creating lab test checkout session:", error);
    await req.auditLogger?.logFailure("lab-test-create-checkout", "CREATE", error);
    res.status(500).json({ success: false, message: "Failed to create checkout session" });
  }
};

// ============================================================================
// Sync order statuses and results from Giddir
// ============================================================================

const TERMINAL_STATUSES: GiddirSubStatus[] = ["signed", "completed-updated", "revoked"];

// Sync deduplication & cooldown
const activeSyncs = new Map<string, Promise<void>>();
const lastSyncTimes = new Map<string, number>();
const SYNC_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
const SYNC_CONCURRENCY = 3; // max parallel Giddir requests

async function syncPendingOrders(patientId: string): Promise<void> {
  if (!isGiddirConfigured()) return;

  // Cooldown: skip if last sync was recent
  const lastSync = lastSyncTimes.get(patientId) || 0;
  if (Date.now() - lastSync < SYNC_COOLDOWN_MS) return;

  // Deduplication: skip if a sync is already running for this patient
  const existing = activeSyncs.get(patientId);
  if (existing) return existing;

  const syncPromise = doSyncPendingOrders(patientId);
  activeSyncs.set(patientId, syncPromise);

  try {
    await syncPromise;
  } finally {
    activeSyncs.delete(patientId);
    lastSyncTimes.set(patientId, Date.now());
  }
}

async function doSyncPendingOrders(patientId: string): Promise<void> {
  // Also run requisitionList reconciliation if patient has a giddirPatientId
  try {
    const patient = await Patient.findById(patientId).select("giddirPatientId").lean();
    if (patient?.giddirPatientId) {
      await reconcileWithRequisitionList(patientId, patient.giddirPatientId);
    }
  } catch (reconcileErr) {
    console.error("Reconciliation error during sync:", reconcileErr);
  }

  const pendingOrders = await LabTestOrder.find({
    patient: patientId,
    status: { $nin: TERMINAL_STATUSES },
    // Don't try to sync unpaid draft orders — they have no Giddir data yet
    paymentStatus: { $ne: "pending_payment" },
  });

  if (pendingOrders.length === 0) return;

  console.log(`🔄 Syncing ${pendingOrders.length} pending orders from Giddir...`);

  // Process in batches to avoid hammering the API
  for (let i = 0; i < pendingOrders.length; i += SYNC_CONCURRENCY) {
    const batch = pendingOrders.slice(i, i + SYNC_CONCURRENCY);
    await Promise.all(batch.map(async (order) => {
      try {
        const data = order.giddirServiceRequestId
          ? await fetchLabResults(order.giddirServiceRequestId)
          : order.externalTrackingId
            ? await fetchLabResultsByTrackingId(order.externalTrackingId)
            : null;

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
    }));
  }
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
    const query: Record<string, unknown> = {
      patient: userId,
      // Never show draft orders to patients — drafts are temporary checkout placeholders.
      // Only paid/placed orders (status != "draft") should appear in "My Orders".
      status: { $ne: "draft" },
    };
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
        if (!data && orderDoc.externalTrackingId) {
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

    // Extract and save Giddir Patient ID from webhook payload if not already stored
    try {
      const payload = body as Record<string, unknown>;
      let giddirPatientId: string | undefined;

      // Check Bundle entries for Patient resource or ServiceRequest.subject.reference
      if (payload.resourceType === "Bundle" && Array.isArray(payload.entry)) {
        for (const entry of payload.entry as Array<Record<string, unknown>>) {
          const resource = entry.resource as Record<string, unknown>;
          if (!resource) continue;
          if (resource.resourceType === "Patient" && resource.id) {
            giddirPatientId = resource.id as string;
            break;
          }
          if (resource.resourceType === "ServiceRequest") {
            const subject = resource.subject as Record<string, unknown> | undefined;
            const ref = subject?.reference as string | undefined;
            if (ref?.startsWith("Patient/")) {
              giddirPatientId = ref.replace("Patient/", "");
              break;
            }
          }
        }
      }
      // Check raw ServiceRequest subject
      if (!giddirPatientId && payload.resourceType === "ServiceRequest") {
        const subject = payload.subject as Record<string, unknown> | undefined;
        const ref = subject?.reference as string | undefined;
        if (ref?.startsWith("Patient/")) {
          giddirPatientId = ref.replace("Patient/", "");
        }
      }

      if (giddirPatientId && order.patient) {
        await Patient.updateOne(
          { _id: order.patient, giddirPatientId: { $exists: false } },
          { $set: { giddirPatientId } }
        );
      }
    } catch (patientIdError) {
      console.error("Error extracting giddirPatientId from webhook:", patientIdError);
    }

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

// ============================================================================
// Reconcile with Giddir requisitionList — discover missing orders
// ============================================================================

const RESULTS_READY_STATUSES: GiddirSubStatus[] = [
  "partial-report", "final-report", "updated-final-report", "signed", "completed-updated",
];

const lastReconcileTimes = new Map<string, number>();
const RECONCILE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

async function reconcileWithRequisitionList(
  patientId: string,
  giddirPatientId: string,
  bypassCooldown = false
): Promise<{ discovered: number; updated: number }> {
  // Cooldown check
  if (!bypassCooldown) {
    const lastReconcile = lastReconcileTimes.get(patientId) || 0;
    if (Date.now() - lastReconcile < RECONCILE_COOLDOWN_MS) {
      return { discovered: 0, updated: 0 };
    }
  }

  lastReconcileTimes.set(patientId, Date.now());

  const requisitions = await fetchRequisitionList(giddirPatientId);
  if (requisitions.length === 0) return { discovered: 0, updated: 0 };

  // Fetch all local orders for this patient (including drafts and terminal)
  const localOrders = await LabTestOrder.find({ patient: patientId });

  let discovered = 0;
  let updated = 0;

  for (const req of requisitions) {
    // Try to find a matching local order
    const existingOrder = localOrders.find(
      (o) =>
        (o.giddirServiceRequestId && o.giddirServiceRequestId === req.serviceRequestId) ||
        (o.externalTrackingId && o.externalTrackingId === req.externalTrackingId)
    );

    if (existingOrder) {
      // Update status if changed and not already terminal
      if (
        req.subStatus &&
        req.subStatus !== existingOrder.status &&
        !TERMINAL_STATUSES.includes(existingOrder.status as GiddirSubStatus)
      ) {
        existingOrder.status = req.subStatus;
        existingOrder.statusHistory.push({ status: req.subStatus, timestamp: new Date() });
        if (TERMINAL_STATUSES.includes(req.subStatus)) {
          existingOrder.completedAt = new Date();
        }
        // Backfill giddirServiceRequestId if missing
        if (!existingOrder.giddirServiceRequestId) {
          existingOrder.giddirServiceRequestId = req.serviceRequestId;
        }
        await existingOrder.save();
        updated++;
      }
    } else {
      // Discovered a new order not in our local DB — create it
      const newOrder = new LabTestOrder({
        patient: patientId,
        giddirServiceRequestId: req.serviceRequestId,
        externalTrackingId: req.externalTrackingId || undefined,
        testPackage: {
          id: "discovered",
          productCode: "unknown",
          name: "Discovered Lab Test",
          nameSv: "Upptäckt labbtest",
        },
        status: req.subStatus || "created",
        paymentStatus: "paid", // Assume paid since it exists in Giddir
        statusHistory: [
          { status: req.subStatus || "created", timestamp: new Date(req.authoredOn || Date.now()) },
        ],
        results: [],
        orderedAt: new Date(req.authoredOn || Date.now()),
      });
      await newOrder.save();
      discovered++;

      // If results are potentially available, fetch them
      if (req.subStatus && RESULTS_READY_STATUSES.includes(req.subStatus)) {
        try {
          const data = await fetchLabResults(req.serviceRequestId);
          if (data && data.observations.length > 0) {
            for (const obs of data.observations) {
              newOrder.results.push(parseObservationToResult(obs));
            }
            if (data.subStatus) {
              newOrder.status = data.subStatus;
              newOrder.statusHistory.push({ status: data.subStatus, timestamp: new Date() });
            }
            await newOrder.save();
          }
        } catch (fetchErr) {
          console.error(`Error fetching results for discovered order ${req.serviceRequestId}:`, fetchErr);
        }
      }
    }
  }

  if (discovered > 0 || updated > 0) {
    console.log(`Reconciliation complete: ${discovered} discovered, ${updated} updated for patient ${patientId}`);
  }

  return { discovered, updated };
}

// ============================================================================
// POST /sync — Force sync with Giddir (bypasses cooldown)
// ============================================================================

export const forceSyncOrders = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    if (!isGiddirConfigured()) {
      res.status(503).json({ success: false, message: "Lab test service not configured" });
      return;
    }

    const patient = await Patient.findById(userId);
    if (!patient) {
      res.status(404).json({ success: false, message: "Patient not found" });
      return;
    }

    let syncResult = { discovered: 0, updated: 0 };

    // Run requisitionList reconciliation if we have a giddirPatientId
    if (patient.giddirPatientId) {
      syncResult = await reconcileWithRequisitionList(userId, patient.giddirPatientId, true);
    }

    // Also run the normal pending order sync (bypassing cooldown)
    lastSyncTimes.delete(userId);
    await syncPendingOrders(userId);

    // Fetch fresh orders to return
    const orders = await LabTestOrder.find({
      patient: userId,
      status: { $ne: "draft" },
    })
      .sort({ orderedAt: -1 })
      .lean();

    await req.auditLogger?.logSuccess(
      "lab-test-force-sync",
      "READ",
      userId,
      { discovered: syncResult.discovered, updated: syncResult.updated }
    );

    res.status(200).json({
      success: true,
      orders,
      discovered: syncResult.discovered,
      updated: syncResult.updated,
    });
  } catch (error) {
    console.error("Error force-syncing lab test orders:", error);
    await req.auditLogger?.logFailure("lab-test-force-sync", "READ", error);
    res.status(500).json({ success: false, message: "Failed to sync orders" });
  }
};
