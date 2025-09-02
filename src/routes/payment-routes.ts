import express from "express";
import Stripe from 'stripe';
import stripeService from "../services/stripe-service";
import { 
  createPaymentIntent,
  createSetupIntent,
  createCheckoutSession,
  getSubscriptionStatus,
  cancelSubscription,
  createPortalSession,
  handleSuccessfulPayment,
  handleFailedPayment,
  handleSubscriptionUpdate,
  handleSubscriptionDeleted,
  handlePaymentIntentSucceeded,
  handleSetupIntentSucceeded
} from "../controllers/payment-controllers";
import { requireAuth, requireCSRF } from "../middleware/auth-middleware";

const router = express.Router();

router.post("/create-payment-intent", requireAuth, requireCSRF, createPaymentIntent);

router.post("/create-setup-intent", requireAuth, requireCSRF, createSetupIntent);

router.post("/create-checkout-session", requireAuth, requireCSRF, createCheckoutSession);

router.get("/subscription/status", requireAuth, requireCSRF, getSubscriptionStatus);

router.post("/subscription/cancel", requireAuth, requireCSRF, cancelSubscription);

router.post("/create-portal-session", requireAuth, requireCSRF, createPortalSession);

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
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        await handleFailedPayment(session);
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