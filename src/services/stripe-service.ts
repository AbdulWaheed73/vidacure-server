import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
  typescript: true,
});

export const stripeService = {
  stripe,

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

    let priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData;
    
    if (planType === 'lifestyle') {
      priceData = {
        currency: 'sek',
        product_data: {
          name: 'Lifestyle Program Membership',
          description: 'Your access to expert coaching and support for a healthier lifestyle.',
        },
        unit_amount: 79500, // 795 SEK in öre
        recurring: {
          interval: 'month',
        },
      };
    } else if (planType === 'medical') {
      priceData = {
        currency: 'sek',
        product_data: {
          name: 'Medical Program Membership',
          description: 'Your all-in-one access to our medical team, coaching, and support.',
        },
        unit_amount: 149500, // 1495 SEK in öre
        recurring: {
          interval: 'month',
        },
      };
    } else {
      throw new Error('Invalid plan type');
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: priceData,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        planType,
        ...metadata,
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
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
  }) => {
    const { customerId, planType, paymentMethodId, metadata } = params;

    let priceData: {
      currency: string;
      unit_amount: number;
      recurring: { interval: 'month' };
      product_data: { name: string; description: string };
    };
    
    if (planType === 'lifestyle') {
      priceData = {
        currency: 'sek',
        unit_amount: 79500, // 795 SEK in öre
        recurring: { interval: 'month' },
        product_data: {
          name: 'Lifestyle Program Membership',
          description: 'Your access to expert coaching and support for a healthier lifestyle.',
        },
      };
    } else if (planType === 'medical') {
      priceData = {
        currency: 'sek',
        unit_amount: 149500, // 1495 SEK in öre
        recurring: { interval: 'month' },
        product_data: {
          name: 'Medical Program Membership',
          description: 'Your all-in-one access to our medical team, coaching, and support.',
        },
      };
    } else {
      throw new Error('Invalid plan type');
    }

    // Create a price for the subscription
    const price = await stripe.prices.create(priceData);

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: price.id }],
      metadata: {
        planType,
        ...metadata,
      },
      expand: ['latest_invoice.payment_intent'],
    };

    if (paymentMethodId) {
      subscriptionParams.default_payment_method = paymentMethodId;
    }

    return await stripe.subscriptions.create(subscriptionParams);
  },

  retrievePaymentMethod: async (paymentMethodId: string) => {
    return await stripe.paymentMethods.retrieve(paymentMethodId);
  },

  attachPaymentMethodToCustomer: async (paymentMethodId: string, customerId: string) => {
    return await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  },
};

export default stripeService;