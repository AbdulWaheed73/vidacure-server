import express from "express";
import stripeService from "../services/stripe-service";
import PatientSchema from "../schemas/patient-schema";
import CancellationFeedbackSchema from "../schemas/cancellation-feedback-schema";
import LabTestOrder from "../schemas/lab-test-order-schema";
import Stripe from "stripe";
import { assignDoctorRoundRobin } from "../services/doctor-assignment-service";
import { placeLabTestOrderForPatient } from "../services/lab-test-order-service";
import { sendLabTestOrderConfirmation } from "../services/email-service";
import { LAB_TEST_PACKAGES } from "../config/lab-test-packages";
import type { CancellationReason } from "../types/cancellation-feedback-type";

// Helper to get frontend URL without trailing slash
const getFrontendUrl = (): string => {
  const url = process.env.FRONTEND_URL;
  return url?.replace(/\/+$/, '') || '';
};

// Helper function to log critical webhook errors
const logCriticalWebhookError = (
  context: string,
  error: any,
  additionalData?: Record<string, any>
) => {
  const errorData = {
    timestamp: new Date().toISOString(),
    context,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...additionalData,
  };

  console.error(
    `[CRITICAL WEBHOOK ERROR] ${context}:`,
    JSON.stringify(errorData, null, 2)
  );

  // TODO: Integrate with monitoring service (Sentry, Datadog, etc.)
  // Example: Sentry.captureException(error, { contexts: { webhook: errorData } });
};

// Helper to extract period dates from a Stripe subscription.
// In API version 2025-08-27.basil, current_period_start/end moved
// from the subscription root to subscription.items.data[].
const getSubscriptionPeriod = (subscription: Stripe.Subscription) => {
  const item = subscription.items?.data?.[0] as any;
  const start: number | undefined =
    item?.current_period_start ??
    (subscription as any).current_period_start;
  const end: number | undefined =
    item?.current_period_end ??
    (subscription as any).current_period_end;
  return { start, end };
};

// Helper function to validate plan type
const isValidPlanType = (
  planType: any
): planType is "lifestyle" | "medical" => {
  return planType === "lifestyle" || planType === "medical";
};

// OPTION 1: Create Setup Intent for subscription (RECOMMENDED)
export const createSetupIntent = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { planType } = req.body;
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!isValidPlanType(planType)) {
      return res
        .status(400)
        .json({ error: 'Invalid plan type. Must be "lifestyle" or "medical"' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    let customerId = patient.subscription?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        patient.email || `patient-${patient._id}@vidacure.com`,
        patient.name,
        {
          userId: userId.toString(),
          planType, // Store plan type for later use
        }
      );
      customerId = customer.id;

      // Initialize subscription object if it doesn't exist
      if (!patient.subscription) {
        patient.subscription = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: "",
          stripePriceId: "",
          stripeProductId: "",
          status: "incomplete",
          planType: planType as "lifestyle" | "medical",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        };
      } else {
        patient.subscription.stripeCustomerId = customerId;
      }
      await patient.save();
    }

    // Create a SetupIntent for collecting payment method
    const setupIntent = await stripeService.stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session", // Will be used for recurring payments
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId: userId.toString(),
        planType,
      },
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
    });
  } catch (error: any) {
    console.error("Error creating setup intent:", error);
    res.status(500).json({ error: error.message });
  }
};

// OPTION 2: Modified createPaymentIntent that attaches payment method immediately
export const createPaymentIntent = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { planType } = req.body;
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!isValidPlanType(planType)) {
      return res
        .status(400)
        .json({ error: 'Invalid plan type. Must be "lifestyle" or "medical"' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const amount = planType === "lifestyle" ? 79500 : 149500;

    let customerId = patient.subscription?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        patient.email || `patient-${patient._id}@vidacure.com`,
        patient.name,
        {
          userId: userId.toString(),
        }
      );
      customerId = customer.id;

      // Initialize subscription object if it doesn't exist
      if (!patient.subscription) {
        patient.subscription = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: "",
          stripePriceId: "",
          stripeProductId: "",
          status: "incomplete",
          planType: planType as "lifestyle" | "medical",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        };
      } else {
        patient.subscription.stripeCustomerId = customerId;
      }
      await patient.save();
    }

    const paymentIntent = await stripeService.createPaymentIntent({
      amount,
      currency: "sek",
      customerId,
      setup_future_usage: "off_session", // This will attach the payment method to the customer
      metadata: {
        userId: userId.toString(),
        planType,
        createSubscription: "true", // Flag to indicate subscription creation
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      customerId,
    });
  } catch (error: any) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: error.message });
  }
};

export const createCheckoutSession = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const { planType } = req.body;
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!isValidPlanType(planType)) {
      return res
        .status(400)
        .json({ error: 'Invalid plan type. Must be "lifestyle" or "medical"' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    // Check meeting gate - must have completed consultation before subscribing
    const meetingStatus = patient.calendly?.meetingStatus || "none";
    const scheduledMeetingTime = patient.calendly?.scheduledMeetingTime;

    // Meeting gate is passed if:
    // 1. Meeting is marked as completed, OR
    // 2. Meeting is scheduled AND the scheduled time has passed
    const isMeetingGatePassed =
      meetingStatus === "completed" ||
      (meetingStatus === "scheduled" &&
        scheduledMeetingTime &&
        new Date() > new Date(scheduledMeetingTime));

    if (!isMeetingGatePassed) {
      return res.status(403).json({
        error: "Meeting required",
        message: "You must complete a consultation with your doctor before subscribing",
        meetingStatus,
        scheduledMeetingTime,
      });
    }

    const frontendUrl = getFrontendUrl();

    // Validate frontend URL is set
    if (!frontendUrl) {
      console.error("Frontend URL not configured");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const successUrl = `${frontendUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendUrl}/subscription/canceled`;

    let customerId = patient.subscription?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        patient.email || `patient-${patient._id}@vidacure.com`,
        patient.name,
        {
          userId: userId.toString(),
        }
      );
      customerId = customer.id;

      // Initialize subscription object if it doesn't exist
      if (!patient.subscription) {
        patient.subscription = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: "",
          stripePriceId: "",
          stripeProductId: "",
          status: "incomplete",
          planType: planType as "lifestyle" | "medical",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: false,
        };
      } else {
        patient.subscription.stripeCustomerId = customerId;
      }
      await patient.save();
    }

    // Ensure Stripe customer has the patient's real email
    if (patient.email) {
      await stripeService.updateCustomer(customerId, { email: patient.email });
    }

    const session = await stripeService.createCheckoutSession({
      customerId,
      planType,
      successUrl,
      cancelUrl,
      metadata: {
        userId: userId.toString(),
        planType,
      },
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      customerId,
    });
  } catch (error: any) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getSubscriptionStatus = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    let subscriptionData = null;

    if (patient.subscription?.stripeSubscriptionId) {
      try {
        const subscription = await stripeService.retrieveSubscription(
          patient.subscription.stripeSubscriptionId
        );
        const { start, end } = getSubscriptionPeriod(subscription);
        subscriptionData = {
          id: subscription.id,
          status: subscription.status,
          planType: patient.subscription?.planType,
          currentPeriodStart: start
            ? new Date(start * 1000)
            : patient.subscription?.currentPeriodStart || new Date(),
          currentPeriodEnd: end
            ? new Date(end * 1000)
            : patient.subscription?.currentPeriodEnd || new Date(),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        };
      } catch (error) {
        console.error("Error fetching Stripe subscription:", error);
      }
    }

    // Determine if user has a usable subscription
    // An active subscription (including cancel_at_period_end during the period) counts as "has subscription"
    // A fully canceled subscription does not
    const liveStatus = subscriptionData?.status || patient.subscription?.status;
    const isActiveSubscription = liveStatus === 'active' || liveStatus === 'trialing' || liveStatus === 'past_due';

    res.json({
      hasSubscription: !!patient.subscription?.stripeSubscriptionId && isActiveSubscription,
      subscriptionStatus: liveStatus || patient.subscription?.status,
      planType: patient.subscription?.planType,
      subscription: subscriptionData,
    });
  } catch (error: any) {
    console.error("Error getting subscription status:", error);
    res.status(500).json({ error: error.message });
  }
};

export const cancelSubscription = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { reason } = req.body as { reason?: CancellationReason };

    const validReasons: CancellationReason[] = ['too_expensive', 'no_results', 'reached_goal', 'technical_issues', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({ error: "A valid cancellation reason is required" });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.subscription?.stripeSubscriptionId) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const subscription = await stripeService.cancelSubscription(
      patient.subscription.stripeSubscriptionId
    );

    // Calculate subscription duration in days
    let subscriptionDuration: number | undefined;
    if (patient.subscription.currentPeriodStart) {
      const startDate = new Date(patient.subscription.currentPeriodStart);
      const now = new Date();
      subscriptionDuration = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Save cancellation feedback
    await CancellationFeedbackSchema.create({
      patientId: userId,
      reason,
      planType: patient.subscription.planType || 'lifestyle',
      subscriptionDuration,
    });

    // Update nested subscription object
    // With cancel_at_period_end, subscription stays "active" until period ends
    if (patient.subscription) {
      const { end } = getSubscriptionPeriod(subscription);
      patient.subscription.canceledAt = new Date();
      patient.subscription.cancelAtPeriodEnd = true;
      if (end) {
        patient.subscription.currentPeriodEnd = new Date(end * 1000);
      }
    }
    await patient.save();

    const { end: periodEnd } = getSubscriptionPeriod(subscription);

    res.json({
      message: "Subscription canceled successfully",
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd
          ? new Date(periodEnd * 1000)
          : patient.subscription?.currentPeriodEnd,
      },
    });
  } catch (error: any) {
    console.error("Error canceling subscription:", error);
    res.status(500).json({ error: error.message });
  }
};

export const changePlan = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { planType } = req.body;

    if (!isValidPlanType(planType)) {
      return res
        .status(400)
        .json({ error: 'Invalid plan type. Must be "lifestyle" or "medical"' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.subscription?.stripeSubscriptionId) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    if (patient.subscription.planType === planType) {
      return res.status(400).json({ error: "You are already on this plan" });
    }

    // Retrieve current subscription to get the item ID
    const currentSubscription = await stripeService.retrieveSubscription(
      patient.subscription.stripeSubscriptionId
    );

    if (currentSubscription.status !== "active") {
      return res.status(400).json({ error: "Can only change plan on an active subscription" });
    }

    const currentItemId = currentSubscription.items.data[0]?.id;
    if (!currentItemId) {
      return res.status(400).json({ error: "No subscription item found" });
    }

    const newPriceId = stripeService.getPriceId(planType);
    const isUpgrade = patient.subscription.planType === "lifestyle" && planType === "medical";

    if (isUpgrade) {
      // Calculate proration amount via invoice preview
      const prorationDate = Math.floor(Date.now() / 1000);
      const preview = await stripeService.stripe.invoices.createPreview({
        customer: patient.subscription.stripeCustomerId,
        subscription: patient.subscription.stripeSubscriptionId,
        subscription_details: {
          items: [{ id: currentItemId, price: newPriceId }],
          proration_date: prorationDate,
          proration_behavior: "create_prorations",
        },
      });

      const prorationAmount = preview.amount_due; // in öre (smallest currency unit)

      if (prorationAmount > 0) {
        // Create a one-time payment checkout for the proration difference
        const frontendUrl = getFrontendUrl();
        if (!frontendUrl) {
          return res.status(500).json({ error: "Server configuration error" });
        }

        // Ensure Stripe customer has the patient's real email
        if (patient.email) {
          await stripeService.updateCustomer(patient.subscription.stripeCustomerId, {
            email: patient.email,
          });
        }

        const session = await stripeService.stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer: patient.subscription.stripeCustomerId,
          line_items: [
            {
              price_data: {
                currency: "sek",
                unit_amount: prorationAmount,
                product_data: {
                  name: "Upgrade to Medical Program (prorated)",
                },
              },
              quantity: 1,
            },
          ],
          success_url: `${frontendUrl}/account?plan_changed=true`,
          cancel_url: `${frontendUrl}/account`,
          metadata: {
            type: "plan_change",
            userId: userId.toString(),
            newPlanType: planType,
            subscriptionId: patient.subscription.stripeSubscriptionId,
            subscriptionItemId: currentItemId,
            newPriceId,
          },
        });

        return res.json({ checkoutUrl: session.url });
      }

      // Proration is 0 (e.g. same-day change) — update directly
      const updated = await stripeService.updateSubscription(
        patient.subscription.stripeSubscriptionId,
        {
          items: [{ id: currentItemId, price: newPriceId }],
          proration_behavior: "none",
        }
      );

      patient.subscription.planType = planType;
      patient.subscription.stripePriceId = newPriceId;
      patient.subscription.stripeProductId = updated.items.data[0].price.product as string;
      await patient.save();

      return res.json({ message: "Plan changed successfully" });
    }

    // Downgrade: update subscription directly, credit applied to next invoice
    const updated = await stripeService.updateSubscription(
      patient.subscription.stripeSubscriptionId,
      {
        items: [{ id: currentItemId, price: newPriceId }],
        proration_behavior: "create_prorations",
      }
    );

    patient.subscription.planType = planType;
    patient.subscription.stripePriceId = newPriceId;
    patient.subscription.stripeProductId = updated.items.data[0].price.product as string;
    await patient.save();

    res.json({ message: "Plan changed successfully" });
  } catch (error: any) {
    console.error("Error changing plan:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getInvoiceHistory = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.subscription?.stripeCustomerId) {
      return res.json({ invoices: [] });
    }

    const invoices = await stripeService.getCustomerInvoices(
      patient.subscription.stripeCustomerId
    );

    const mappedInvoices = invoices.map((invoice) => ({
      id: invoice.id,
      date: new Date(invoice.created * 1000).toISOString(),
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status,
      planType: invoice.lines?.data?.[0]?.metadata?.planType || patient.subscription?.planType || null,
      invoicePdf: invoice.invoice_pdf || null,
      receiptUrl: invoice.hosted_invoice_url || null,
    }));

    res.json({ invoices: mappedInvoices });
  } catch (error: any) {
    console.error("Error fetching invoice history:", error);
    res.status(500).json({ error: error.message });
  }
};

export const createPortalSession = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.subscription?.stripeCustomerId) {
      return res.status(404).json({ error: "No Stripe customer found" });
    }

    const frontendUrl = getFrontendUrl();

    // Validate frontend URL is set
    if (!frontendUrl) {
      console.error("Frontend URL not configured");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const returnUrl = `${frontendUrl}/subscription`;
    const session = await stripeService.createPortalSession(
      patient.subscription.stripeCustomerId,
      returnUrl
    );

    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Error creating portal session:", error);
    res.status(500).json({ error: error.message });
  }
};

export const handlePlanChangeCompleted = async (
  session: Stripe.Checkout.Session
) => {
  try {
    console.log("Processing plan change payment for session:", session.id);

    const { userId, newPlanType, subscriptionId, subscriptionItemId, newPriceId } =
      session.metadata || {};

    if (!userId || !newPlanType || !subscriptionId || !subscriptionItemId || !newPriceId) {
      console.error("Missing metadata in plan change session:", session.metadata);
      return;
    }

    // Update the subscription with no proration (already paid via checkout)
    const updated = await stripeService.updateSubscription(subscriptionId, {
      items: [{ id: subscriptionItemId, price: newPriceId }],
      proration_behavior: "none",
    });

    // Update patient record
    const patient = await PatientSchema.findById(userId);
    if (patient?.subscription) {
      patient.subscription.planType = newPlanType as "lifestyle" | "medical";
      patient.subscription.stripePriceId = newPriceId;
      patient.subscription.stripeProductId = updated.items.data[0].price.product as string;
      await patient.save();
      console.log("Plan change completed for patient:", userId, "→", newPlanType);
    }
  } catch (error) {
    logCriticalWebhookError("handlePlanChangeCompleted", error, {
      sessionId: session?.id,
    });
  }
};

export const handleSuccessfulPayment = async (
  session: Stripe.Checkout.Session
) => {
  try {
    console.log("Processing successful payment for session:", session.id);

    const userId = session.metadata?.userId;
    if (!userId) {
      console.error("No userId found in session metadata");
      return;
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      console.error("Patient not found for userId:", userId);
      return;
    }

    const subscriptionId = session.subscription as string;
    if (!subscriptionId) {
      console.error("No subscription found in session");
      return;
    }

    // Retrieve the full subscription object from Stripe
    const subscription =
      await stripeService.retrieveSubscription(subscriptionId);

    const { start: startTimestamp, end: endTimestamp } = getSubscriptionPeriod(subscription);

    // Update patient with nested subscription object
    patient.subscription = {
      stripeCustomerId: session.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.items.data[0].price.id,
      stripeProductId: subscription.items.data[0].price.product as string,
      status: subscription.status as
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid",
      planType: session.metadata?.planType as "lifestyle" | "medical",
      currentPeriodStart: startTimestamp
        ? new Date(startTimestamp * 1000)
        : new Date(),
      currentPeriodEnd: endTimestamp
        ? new Date(endTimestamp * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialStart: subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : undefined,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : undefined,
    };

    await patient.save();

    console.log("Successfully processed payment for patient:", patient._id);

    // Auto-assign doctor if subscription is active and no doctor assigned
    if (subscription.status === "active" && !patient.doctor) {
      console.log(
        "[Auto-Assignment] Triggering doctor assignment for patient:",
        patient._id
      );
      try {
        await assignDoctorRoundRobin(patient._id.toString());
        console.log(
          "[Auto-Assignment] Successfully assigned doctor to patient:",
          patient._id
        );
      } catch (assignError) {
        console.error(
          "[Auto-Assignment] Failed to assign doctor to patient:",
          patient._id,
          assignError
        );
        // Don't throw - payment was successful, assignment can be done manually later
      }
    }

  } catch (error) {
    logCriticalWebhookError("handleSuccessfulPayment", error, {
      sessionId: session?.id,
      customerId: session?.customer,
      subscriptionId: session?.subscription,
    });
  }
};

export const handleFailedPayment = async (session: Stripe.Checkout.Session) => {
  try {
    console.log("Processing failed payment for session:", session.id);

    const userId = session.metadata?.userId;
    if (userId) {
      const patient = await PatientSchema.findById(userId);
      if (patient && patient.subscription) {
        patient.subscription.status = "unpaid";
        await patient.save();
      }
    }
  } catch (error) {
    logCriticalWebhookError("handleFailedPayment", error, {
      sessionId: session?.id,
      customerId: session?.customer,
    });
  }
};

export const handleSubscriptionUpdate = async (
  subscription: Stripe.Subscription
) => {
  try {
    console.log("Processing subscription update:", subscription.id);

    const patient = await PatientSchema.findOne({
      "subscription.stripeSubscriptionId": subscription.id,
    });
    if (!patient) {
      console.error("Patient not found for subscription:", subscription.id);
      return;
    }

    const { start: updateStartTimestamp, end: updateEndTimestamp } = getSubscriptionPeriod(subscription);

    // Update nested subscription object
    if (patient.subscription) {
      patient.subscription.status = subscription.status as
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid";
      patient.subscription.currentPeriodStart = updateStartTimestamp
        ? new Date(updateStartTimestamp * 1000)
        : new Date();
      patient.subscription.currentPeriodEnd = updateEndTimestamp
        ? new Date(updateEndTimestamp * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      patient.subscription.cancelAtPeriodEnd =
        subscription.cancel_at_period_end;
    }

    await patient.save();

    console.log("Successfully updated subscription for patient:", patient._id);

    // Auto-assign doctor if subscription became active and no doctor assigned
    if (subscription.status === "active" && !patient.doctor) {
      console.log(
        "[Auto-Assignment] Triggering doctor assignment for patient:",
        patient._id
      );
      try {
        await assignDoctorRoundRobin(patient._id.toString());
        console.log(
          "[Auto-Assignment] Successfully assigned doctor to patient:",
          patient._id
        );
      } catch (assignError) {
        console.error(
          "[Auto-Assignment] Failed to assign doctor to patient:",
          patient._id,
          assignError
        );
        // Don't throw - subscription update was successful
      }
    }

  } catch (error) {
    logCriticalWebhookError("handleSubscriptionUpdate", error, {
      subscriptionId: subscription?.id,
      customerId: subscription?.customer,
      status: subscription?.status,
    });
  }
};

export const handleSubscriptionDeleted = async (
  subscription: Stripe.Subscription
) => {
  try {
    console.log("Processing subscription deletion:", subscription.id);

    const patient = await PatientSchema.findOne({
      "subscription.stripeSubscriptionId": subscription.id,
    });
    if (!patient) {
      console.error("Patient not found for subscription:", subscription.id);
      return;
    }

    // Update nested subscription object
    if (patient.subscription) {
      patient.subscription.status = "canceled";
      patient.subscription.canceledAt = new Date();
    }

    await patient.save();

    console.log(
      "Successfully processed subscription deletion for patient:",
      patient._id
    );
  } catch (error) {
    logCriticalWebhookError("handleSubscriptionDeleted", error, {
      subscriptionId: subscription?.id,
      customerId: subscription?.customer,
    });
  }
};

// Handle successful setup intent (for OPTION 1)
export const handleSetupIntentSucceeded = async (
  setupIntent: Stripe.SetupIntent
) => {
  try {
    console.log("Processing successful setup intent:", setupIntent.id);

    const userId = setupIntent.metadata?.userId;
    const planType = setupIntent.metadata?.planType;

    if (!userId || !planType) {
      console.error("Missing required metadata in setup intent");
      return;
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      console.error("Patient not found for userId:", userId);
      return;
    }

    // Use pre-created price from environment variables
    const priceId = stripeService.getPriceId(
      planType as "lifestyle" | "medical"
    );
    console.log("Using price ID for plan type:", planType);

    // Create subscription with the attached payment method and idempotency
    const subscriptionIdempotencyKey = `sub-${setupIntent.customer}-${planType}-${setupIntent.id}`;
    const subscription = await stripeService.stripe.subscriptions.create(
      {
        customer: setupIntent.customer as string,
        items: [
          {
            price: priceId,
          },
        ],
        default_payment_method: setupIntent.payment_method as string,
        metadata: setupIntent.metadata,
      },
      {
        idempotencyKey: subscriptionIdempotencyKey,
      }
    );

    // Update patient record with nested subscription object
    const { start: startTimestamp, end: endTimestamp } = getSubscriptionPeriod(subscription);

    patient.subscription = {
      stripeCustomerId: setupIntent.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeProductId: subscription.items.data[0].price.product as string,
      status: subscription.status as
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid",
      planType: planType as "lifestyle" | "medical",
      currentPeriodStart: startTimestamp
        ? new Date(startTimestamp * 1000)
        : new Date(),
      currentPeriodEnd: endTimestamp
        ? new Date(endTimestamp * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialStart: subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : undefined,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : undefined,
    };

    await patient.save();

    console.log(
      "Successfully created subscription from setup intent for patient:",
      patient._id
    );

    // Auto-assign doctor if subscription is active and no doctor assigned
    if (subscription.status === "active" && !patient.doctor) {
      console.log(
        "[Auto-Assignment] Triggering doctor assignment for patient:",
        patient._id
      );
      try {
        await assignDoctorRoundRobin(patient._id.toString());
        console.log(
          "[Auto-Assignment] Successfully assigned doctor to patient:",
          patient._id
        );
      } catch (assignError) {
        console.error(
          "[Auto-Assignment] Failed to assign doctor to patient:",
          patient._id,
          assignError
        );
        // Don't throw - setup intent was successful
      }
    }

  } catch (error) {
    logCriticalWebhookError("handleSetupIntentSucceeded", error, {
      setupIntentId: setupIntent?.id,
      customerId: setupIntent?.customer,
      planType: setupIntent?.metadata?.planType,
    });
  }
};

// Modified handlePaymentIntentSucceeded for OPTION 2
export const handlePaymentIntentSucceeded = async (
  paymentIntent: Stripe.PaymentIntent
) => {
  try {
    console.log("Processing successful payment intent:", paymentIntent.id);

    const userId = paymentIntent.metadata?.userId;
    const planType = paymentIntent.metadata?.planType;
    const createSubscription =
      paymentIntent.metadata?.createSubscription === "true";

    if (!userId || !planType) {
      console.error("Missing required metadata in payment intent");
      return;
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      console.error("Patient not found for userId:", userId);
      return;
    }

    // If setup_future_usage was set, the payment method is already attached
    // Only create subscription if explicitly requested
    if (!createSubscription) {
      console.log(
        "Payment processed successfully, no subscription creation requested"
      );
      return;
    }

    // Use pre-created price from environment variables
    const priceId = stripeService.getPriceId(
      planType as "lifestyle" | "medical"
    );
    console.log("Using price ID for plan type:", planType);

    const paymentMethod = paymentIntent.payment_method;
    if (!paymentMethod || typeof paymentMethod !== "string") {
      console.error(
        "No payment method found in payment intent:",
        paymentIntent.id
      );
      throw new Error("No payment method available for subscription creation");
    }

    // The payment method should already be attached if setup_future_usage was set
    // Just set it as the default payment method
    try {
      await stripeService.stripe.customers.update(
        paymentIntent.customer as string,
        {
          invoice_settings: {
            default_payment_method: paymentMethod,
          },
        }
      );
      console.log("Set default payment method for customer");
    } catch (error: any) {
      console.error("Error setting default payment method:", error);
    }

    // Create subscription with the attached payment method and idempotency
    const subscriptionIdempotencyKey = `sub-${paymentIntent.customer}-${planType}-${paymentIntent.id}`;
    const subscription = await stripeService.stripe.subscriptions.create(
      {
        customer: paymentIntent.customer as string,
        items: [
          {
            price: priceId,
          },
        ],
        default_payment_method: paymentMethod,
        metadata: paymentIntent.metadata,
      },
      {
        idempotencyKey: subscriptionIdempotencyKey,
      }
    );

    // Update patient record with nested subscription object
    const { start: startTimestamp, end: endTimestamp } = getSubscriptionPeriod(subscription);

    patient.subscription = {
      stripeCustomerId: paymentIntent.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeProductId: subscription.items.data[0].price.product as string,
      status: subscription.status as
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid",
      planType: planType as "lifestyle" | "medical",
      currentPeriodStart: startTimestamp
        ? new Date(startTimestamp * 1000)
        : new Date(),
      currentPeriodEnd: endTimestamp
        ? new Date(endTimestamp * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialStart: subscription.trial_start
        ? new Date(subscription.trial_start * 1000)
        : undefined,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : undefined,
    };

    await patient.save();

    console.log(
      "Successfully processed payment intent for patient:",
      patient._id,
      {
        subscriptionId: subscription.id,
        planType: planType,
      }
    );
  } catch (error) {
    logCriticalWebhookError("handlePaymentIntentSucceeded", error, {
      paymentIntentId: paymentIntent?.id,
      customerId: paymentIntent?.customer,
      planType: paymentIntent?.metadata?.planType,
      createSubscription: paymentIntent?.metadata?.createSubscription,
    });
  }
};

// ============================================================================
// Lab Test Payment Handlers
// ============================================================================

export const handleLabTestPaymentCompleted = async (
  session: Stripe.Checkout.Session
) => {
  try {
    console.log("Processing lab test payment for session:", session.id);

    const userId = session.metadata?.userId;
    const testPackageId = session.metadata?.testPackageId;
    const orderId = session.metadata?.orderId;

    if (!userId || !testPackageId || !orderId) {
      console.error("Missing required metadata in lab test checkout session");
      return;
    }

    // Find the pending order
    const order = await LabTestOrder.findById(orderId);
    if (!order) {
      console.error("Lab test order not found:", orderId);
      return;
    }

    // Idempotency: skip if already paid
    if (order.paymentStatus === "paid") {
      console.log("Lab test order already paid, skipping:", orderId);
      return;
    }

    // Update payment status and clear TTL so paid orders aren't auto-deleted
    order.paymentStatus = "paid";
    order.stripePaymentIntentId = session.payment_intent as string;
    order.draftExpiresAt = undefined;
    await order.save();

    // Place the Giddir order
    try {
      await placeLabTestOrderForPatient(userId, testPackageId, orderId);
      console.log("Successfully placed Giddir order for lab test:", orderId);

      // Send confirmation email (fire-and-forget)
      try {
        const patient = await PatientSchema.findById(userId);
        if (patient?.email) {
          const pkg = LAB_TEST_PACKAGES.find((p) => p.id === testPackageId);
          const price = pkg ? `${pkg.priceAmountOre / 100} SEK` : "299 SEK";
          await sendLabTestOrderConfirmation({
            to: patient.email,
            patientName: patient.name || "Patient",
            testPackageName: order.testPackage.name,
            testPackageNameSv: order.testPackage.nameSv,
            price,
            orderedAt: order.orderedAt,
          });
        }
      } catch (emailError) {
        console.error("Failed to send lab test confirmation email (non-blocking):", emailError);
      }
    } catch (giddirError) {
      // Payment succeeded but Giddir failed — log for manual intervention
      logCriticalWebhookError("handleLabTestPaymentCompleted - Giddir placement failed", giddirError, {
        sessionId: session.id,
        orderId,
        userId,
        testPackageId,
      });
      // Order keeps paymentStatus: "paid" so admin can manually retry
    }
  } catch (error) {
    logCriticalWebhookError("handleLabTestPaymentCompleted", error, {
      sessionId: session?.id,
      customerId: session?.customer,
    });
  }
};

export const handleLabTestSessionExpired = async (
  session: Stripe.Checkout.Session
) => {
  try {
    const orderId = session.metadata?.orderId;
    if (!orderId) return;

    const order = await LabTestOrder.findById(orderId);
    if (!order) return;

    if (order.paymentStatus === "paid") return; // Already processed

    // Delete unpaid draft orders — they should not persist in the patient's portal
    await LabTestOrder.findByIdAndDelete(orderId);

    console.log("Lab test checkout session expired, unpaid draft order deleted:", orderId);
  } catch (error) {
    logCriticalWebhookError("handleLabTestSessionExpired", error, {
      sessionId: session?.id,
    });
  }
};
