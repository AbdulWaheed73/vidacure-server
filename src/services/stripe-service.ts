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

// Always fetch fresh product IDs from current price env vars
const getSubscriptionProductIds = async (): Promise<string[]> => {
  const ids: string[] = [];
  for (const planType of ['lifestyle', 'medical'] as const) {
    try {
      const priceId = getPriceId(planType);
      const price = await stripe.prices.retrieve(priceId);
      const productId = typeof price.product === 'string' ? price.product : price.product.id;
      if (!ids.includes(productId)) ids.push(productId);
    } catch {
      // Skip if price not configured
    }
  }
  return ids;
};

// Fetch subscription product details (name, price, ID) for admin context
const getSubscriptionProductDetails = async (): Promise<Array<{
  planType: string;
  priceId: string;
  productId: string;
  productName: string;
  unitAmount: number | null;
  currency: string;
}>> => {
  const details: Array<{
    planType: string;
    priceId: string;
    productId: string;
    productName: string;
    unitAmount: number | null;
    currency: string;
  }> = [];

  for (const planType of ['lifestyle', 'medical'] as const) {
    try {
      const priceId = getPriceId(planType);
      const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
      const product = price.product as Stripe.Product;
      details.push({
        planType,
        priceId,
        productId: product.id,
        productName: product.name,
        unitAmount: price.unit_amount,
        currency: price.currency,
      });
    } catch {
      // Skip if price not configured
    }
  }
  return details;
};

export const stripeService = {
  stripe,
  getPriceId,
  getSubscriptionProductIds,
  getSubscriptionProductDetails,

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
      allow_promotion_codes: true,
      // billing_address_collection: 'required',
    };

    if (customerId) {
      sessionParams.customer = customerId;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    return await stripe.checkout.sessions.create(sessionParams);
  },

  createLabTestCheckoutSession: async (params: {
    customerId: string;
    priceAmountOre: number;
    priceCurrency: string;
    productName: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }) => {
    const { customerId, priceAmountOre, priceCurrency, productName, successUrl, cancelUrl, metadata } = params;

    return await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: priceCurrency,
            unit_amount: priceAmountOre,
            product_data: {
              name: productName,
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      allow_promotion_codes: true,
    });
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
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
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
      expand: ['default_payment_method', 'latest_invoice', 'customer', 'items.data'],
    });

    // In newer Stripe API versions, current_period_start/end moved to subscription items
    const firstItem = subscription.items?.data?.[0];
    const enriched = {
      ...subscription,
      current_period_start: firstItem?.current_period_start ?? null,
      current_period_end: firstItem?.current_period_end ?? null,
    };

    return enriched;
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

  getCustomerInvoices: async (customerId: string, limit: number = 24) => {
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit,
    });
    return invoices.data;
  },

  getCustomerCheckoutPayments: async (customerId: string, limit: number = 24) => {
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit,
      status: 'complete',
    });
    // Only return one-time payment sessions (not subscription)
    return sessions.data.filter(s => s.mode === 'payment');
  },

  getCustomerPaymentMethods: async (customerId: string) => {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return paymentMethods.data;
  },

  // ============ Coupon & Promotion Code Management ============

  createCoupon: async (params: {
    name: string;
    percentOff?: number;
    amountOff?: number;
    currency?: string;
    duration: 'once' | 'repeating' | 'forever';
    durationInMonths?: number;
    maxRedemptions?: number;
    appliesToProductIds?: string[];
  }) => {
    const couponParams: Stripe.CouponCreateParams = {
      name: params.name,
      duration: params.duration,
    };
    if (params.percentOff) couponParams.percent_off = params.percentOff;
    if (params.amountOff) {
      couponParams.amount_off = params.amountOff;
      couponParams.currency = params.currency || 'sek';
    }
    if (params.duration === 'repeating' && params.durationInMonths) {
      couponParams.duration_in_months = params.durationInMonths;
    }
    if (params.maxRedemptions) couponParams.max_redemptions = params.maxRedemptions;
    if (params.appliesToProductIds && params.appliesToProductIds.length > 0) {
      couponParams.applies_to = { products: params.appliesToProductIds };
    }

    return await stripe.coupons.create(couponParams);
  },

  createPromotionCode: async (params: {
    couponId: string;
    code: string;
    maxRedemptions?: number;
    expiresAt?: number;
    metadata?: Record<string, string>;
  }) => {
    const promoParams: Stripe.PromotionCodeCreateParams = {
      coupon: params.couponId,
      code: params.code,
    };
    if (params.maxRedemptions) promoParams.max_redemptions = params.maxRedemptions;
    if (params.expiresAt) promoParams.expires_at = params.expiresAt;
    if (params.metadata) promoParams.metadata = params.metadata;

    return await stripe.promotionCodes.create(promoParams);
  },

  listPromotionCodes: async (params?: {
    active?: boolean;
    limit?: number;
    startingAfter?: string;
  }) => {
    return await stripe.promotionCodes.list({
      active: params?.active,
      limit: params?.limit || 25,
      starting_after: params?.startingAfter,
      expand: ['data.coupon'],
    });
  },

  retrievePromotionCode: async (id: string) => {
    return await stripe.promotionCodes.retrieve(id, {
      expand: ['coupon'],
    });
  },

  deactivatePromotionCode: async (id: string) => {
    return await stripe.promotionCodes.update(id, { active: false });
  },

  /**
   * Delete a Stripe customer (GDPR compliance)
   * Cancels active subscriptions before deleting the customer
   */
  deleteCustomer: async (customerId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // First, retrieve the customer to check for active subscriptions
      const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;

      if (customer.deleted) {
        return { success: true }; // Already deleted
      }

      // Cancel all active subscriptions
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
      });

      for (const subscription of subscriptions.data) {
        await stripe.subscriptions.cancel(subscription.id);
      }

      // Delete the customer
      await stripe.customers.del(customerId);

      return { success: true };
    } catch (error: any) {
      console.error('Error deleting Stripe customer:', error);
      return {
        success: false,
        error: error.message || 'Failed to delete Stripe customer'
      };
    }
  },
};

export default stripeService;