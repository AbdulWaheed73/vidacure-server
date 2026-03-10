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
} from "../controllers/payment-controllers";
import { submitCancellationFeedback } from "../controllers/cancellation-feedback-controller";
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
        if ((invoice as any).subscription) {
          const subscription = await stripeService.retrieveSubscription((invoice as any).subscription as string);
          await handleSubscriptionUpdate(subscription);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log('Payment failed for invoice:', invoice.id);
        if ((invoice as any).subscription) {
          const subscription = await stripeService.retrieveSubscription((invoice as any).subscription as string);
          await handleSubscriptionUpdate(subscription);
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