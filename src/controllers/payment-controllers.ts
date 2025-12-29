import express from "express";
import stripeService from "../services/stripe-service";
import PatientSchema from "../schemas/patient-schema";
import Stripe from "stripe";
import { assignDoctorRoundRobin } from "../services/doctor-assignment-service";

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
    const meetingStatus = patient.meetingStatus || "none";
    const scheduledMeetingTime = patient.scheduledMeetingTime;

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

    const isProduction = process.env.NODE_ENV === "production";
    const frontendUrl = isProduction
      ? process.env.PROD_FRONTEND_URL
      : process.env.DEV_FRONTEND_URL;

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
        subscriptionData = {
          id: subscription.id,
          status: subscription.status,
          planType: patient.subscription?.planType,
          currentPeriodStart: new Date(
            (subscription as any).current_period_start * 1000
          ),
          currentPeriodEnd: new Date(
            (subscription as any).current_period_end * 1000
          ),
          cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
        };
      } catch (error) {
        console.error("Error fetching Stripe subscription:", error);
      }
    }

    res.json({
      hasSubscription: !!patient.subscription?.stripeSubscriptionId,
      subscriptionStatus: patient.subscription?.status,
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

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.subscription?.stripeSubscriptionId) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const subscription = await stripeService.cancelSubscription(
      patient.subscription.stripeSubscriptionId
    );

    // Update nested subscription object
    if (patient.subscription) {
      patient.subscription.status = "canceled";
      patient.subscription.canceledAt = new Date();
      patient.subscription.cancelAtPeriodEnd = (
        subscription as any
      ).cancel_at_period_end;
      patient.subscription.currentPeriodEnd = new Date(
        (subscription as any).current_period_end * 1000
      );
    }
    await patient.save();

    res.json({
      message: "Subscription canceled successfully",
      subscription: {
        id: subscription.id,
        status: subscription.status,
        canceledAt: (subscription as any).canceled_at
          ? new Date((subscription as any).canceled_at * 1000)
          : undefined,
      },
    });
  } catch (error: any) {
    console.error("Error canceling subscription:", error);
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

    const isProduction = process.env.NODE_ENV === "production";
    const frontendUrl = isProduction
      ? process.env.PROD_FRONTEND_URL
      : process.env.DEV_FRONTEND_URL;

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

    const startTimestamp = (subscription as any).current_period_start;
    const endTimestamp = (subscription as any).current_period_end;

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

    const updateStartTimestamp = (subscription as any).current_period_start;
    const updateEndTimestamp = (subscription as any).current_period_end;

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
    const startTimestamp = (subscription as any).current_period_start;
    const endTimestamp = (subscription as any).current_period_end;

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
    const startTimestamp = (subscription as any).current_period_start;
    const endTimestamp = (subscription as any).current_period_end;

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
