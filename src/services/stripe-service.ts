import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
  typescript: true,
});

// Get price IDs from environment variables
const getPriceId = (planType: 'lifestyle' | 'medical'): string => {
  const priceId = planType === 'lifestyle'
    ? process.env.STRIPE_PRICE_LIFESTYLE
    : process.env.STRIPE_PRICE_MEDICAL;

  if (!priceId) {
    throw new Error(`STRIPE_PRICE_${planType.toUpperCase()} environment variable is not set`);
  }

  return priceId;
};

export const stripeService = {
  stripe,
  getPriceId,

  createCustomer: async (email: string, name: string, metadata?: Record<string, string>) => {
    return await stripe.customers.create({
      email,
      name,
      metadata,
    });
  },

  createPaymentIntent: async (params: {
    amount: number;
    currency: string;
    customerId?: string;
    metadata?: Record<string, string>;
    setup_future_usage?: 'off_session' | 'on_session';
  }) => {
    const { amount, currency, customerId, metadata, setup_future_usage } = params;
    
    return await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      metadata,
      setup_future_usage,
      automatic_payment_methods: {
        enabled: true,
      },
    });
  },

  createSetupIntent: async (params: {
    customerId: string;
    metadata?: Record<string, string>;
  }) => {
    const { customerId, metadata } = params;
    
    return await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata,
    });
  },

  createCheckoutSession: async (params: {
    customerId?: string;
    customerEmail?: string;
    planType: 'lifestyle' | 'medical';
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }) => {
    const { customerId, customerEmail, planType, successUrl, cancelUrl, metadata } = params;

    // Use pre-created price IDs from environment variables
    const priceId = getPriceId(planType);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        planType,
        ...metadata,
      },
      // allow_promotion_codes: true,
      // billing_address_collection: 'required',
    };

    if (customerId) {
      sessionParams.customer = customerId;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    return await stripe.checkout.sessions.create(sessionParams);
  },

  retrieveSession: async (sessionId: string) => {
    return await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer'],
    });
  },

  retrieveSubscription: async (subscriptionId: string) => {
    return await stripe.subscriptions.retrieve(subscriptionId);
  },

  cancelSubscription: async (subscriptionId: string) => {
    return await stripe.subscriptions.cancel(subscriptionId);
  },

  updateSubscription: async (subscriptionId: string, params: Stripe.SubscriptionUpdateParams) => {
    return await stripe.subscriptions.update(subscriptionId, params);
  },

  createPortalSession: async (customerId: string, returnUrl: string) => {
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  },

  constructWebhookEvent: (payload: string | Buffer, signature: string) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  },

  retrieveCustomer: async (customerId: string) => {
    return await stripe.customers.retrieve(customerId);
  },

  updateCustomer: async (customerId: string, params: Stripe.CustomerUpdateParams) => {
    return await stripe.customers.update(customerId, params);
  },

  createSubscription: async (params: {
    customerId: string;
    planType: 'lifestyle' | 'medical';
    paymentMethodId?: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }) => {
    const { customerId, planType, paymentMethodId, metadata, idempotencyKey } = params;

    // Use pre-created price IDs from environment variables
    const priceId = getPriceId(planType);

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: priceId }],
      metadata: {
        planType,
        ...metadata,
      },
      expand: ['latest_invoice.payment_intent'],
    };

    if (paymentMethodId) {
      subscriptionParams.default_payment_method = paymentMethodId;
    }

    const options: Stripe.RequestOptions = {};
    if (idempotencyKey) {
      options.idempotencyKey = idempotencyKey;
    }

    return await stripe.subscriptions.create(subscriptionParams, options);
  },

  retrievePaymentMethod: async (paymentMethodId: string) => {
    return await stripe.paymentMethods.retrieve(paymentMethodId);
  },

  attachPaymentMethodToCustomer: async (paymentMethodId: string, customerId: string) => {
    return await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  },

  // Admin-specific methods for fetching detailed subscription information
  getDetailedSubscriptionInfo: async (subscriptionId: string) => {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['default_payment_method', 'latest_invoice', 'customer'],
    });
    return subscription;
  },

  getCustomerDefaultPaymentMethod: async (customerId: string) => {
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;

    if (!customer.invoice_settings?.default_payment_method) {
      return null;
    }

    const paymentMethodId = typeof customer.invoice_settings.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings.default_payment_method.id;

    return await stripe.paymentMethods.retrieve(paymentMethodId);
  },

  getUpcomingInvoice: async (customerId: string) => {
    try {
      return await stripe.invoices.createPreview({
        customer: customerId,
      });
    } catch (error) {
      // No upcoming invoice found (e.g., subscription canceled or no active subscription)
      return null;
    }
  },

  getCustomerPaymentMethods: async (customerId: string) => {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return paymentMethods.data;
  },
};

export default stripeService;