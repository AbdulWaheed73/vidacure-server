import express from "express";
import Stripe from 'stripe';
import stripeService from "../services/stripe-service";
import {
  createPaymentIntent,
  createSetupIntent,
  createCheckoutSession,
  getSubscriptionStatus,
  cancelSubscription,
  changePlan,
  createPortalSession,
  getInvoiceHistory,
  handleSuccessfulPayment,
  handleFailedPayment,
  handleSubscriptionUpdate,
  handleSubscriptionDeleted,
  handlePaymentIntentSucceeded,
  handleSetupIntentSucceeded,
  handleLabTestPaymentCompleted,
  handleLabTestSessionExpired,
  handlePlanChangeCompleted,
  createHypnotherapistCheckout,
  handleHypnotherapistPaymentCompleted,
} from "../controllers/payment-controllers";
import { submitCancellationFeedback } from "../controllers/cancellation-feedback-controller";
import PatientSchema from "../schemas/patient-schema";
import { sendPaymentFailedEmail } from "../services/email-service";
import { requireAuth, requireCSRF, requireRole } from "../middleware/auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";
import { paymentRateLimiter } from "../middleware/rate-limit-middleware";

const router = express.Router();

router.post("/create-payment-intent", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), createPaymentIntent);

router.post("/create-setup-intent", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), createSetupIntent);

router.post("/create-checkout-session", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), createCheckoutSession);

router.get("/subscription/status", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), getSubscriptionStatus);

router.post("/subscription/cancel", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), cancelSubscription);

router.post("/subscription/feedback", requireAuth, requireCSRF, requireRole('patient'), submitCancellationFeedback);

router.post("/subscription/change-plan", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), changePlan);

router.post("/create-portal-session", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), createPortalSession);

router.get("/invoices", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), getInvoiceHistory);

router.post("/hypnotherapist-checkout", paymentRateLimiter, requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), createHypnotherapistCheckout);

router.post("/webhook", express.raw({ type: 'application/json' }), async (req: express.Request, res: express.Response) => {
  const signature = req.headers['stripe-signature'] as string;

  if (!signature) {
    console.error('No stripe-signature header found');
    return res.status(400).send('Missing stripe-signature header');
  }

  try {
    const event = stripeService.constructWebhookEvent(req.body, signature);
    
    console.log('Received Stripe webhook event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          await handleSuccessfulPayment(session);
        } else if (session.mode === 'payment' && session.metadata?.type === 'plan_change') {
          await handlePlanChangeCompleted(session);
        } else if (session.mode === 'payment' && session.metadata?.type === 'lab_test') {
          await handleLabTestPaymentCompleted(session);
        } else if (session.mode === 'payment' && session.metadata?.type === 'hypnotherapist') {
          await handleHypnotherapistPaymentCompleted(session);
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        if (session.metadata?.type === 'lab_test') {
          await handleLabTestSessionExpired(session);
        } else {
          await handleFailedPayment(session);
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        await handlePaymentIntentSucceeded(paymentIntent);
        break;
      }

      case 'setup_intent.succeeded': {
        const setupIntent = event.data.object;
        await handleSetupIntentSucceeded(setupIntent);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef =
          (invoice.parent?.type === 'subscription_details'
            ? invoice.parent.subscription_details?.subscription
            : null) ?? invoice.lines.data[0]?.subscription ?? null;
        const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id;
        if (subscriptionId) {
          const subscription = await stripeService.retrieveSubscription(subscriptionId);
          await handleSubscriptionUpdate(subscription);
        } else {
          console.warn('invoice.payment_succeeded had no subscription id, invoice:', invoice.id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log('Payment failed for invoice:', invoice.id);
        const subRef =
          (invoice.parent?.type === 'subscription_details'
            ? invoice.parent.subscription_details?.subscription
            : null) ?? invoice.lines.data[0]?.subscription ?? null;
        const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id;
        if (subscriptionId) {
          const subscription = await stripeService.retrieveSubscription(subscriptionId);
          await handleSubscriptionUpdate(subscription);

          try {
            const patient = await PatientSchema.findOne({
              "subscription.stripeSubscriptionId": subscriptionId,
            }).select("email").lean();

            if (patient?.email) {
              const amountDue = ((invoice.amount_due ?? 0) / 100).toFixed(2);
              await sendPaymentFailedEmail({
                to: patient.email,
                amount: amountDue,
                currency: (invoice.currency || "sek").toUpperCase(),
                hostedInvoiceUrl: invoice.hosted_invoice_url,
              });
            } else {
              console.warn('Payment failed but patient/email not found for subscription:', subscriptionId);
            }
          } catch (emailErr) {
            console.error('Failed to send payment-failed email:', emailErr);
          }
        } else {
          console.warn('invoice.payment_failed had no subscription id, invoice:', invoice.id);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object;
        console.log('Trial ending soon for subscription:', subscription.id);
        break;
      }

      default:
        console.log('Unhandled Stripe webhook event type:', event.type);
    }

    res.json({ received: true });

  } catch (error: any) {
    console.error('Webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

export default router;