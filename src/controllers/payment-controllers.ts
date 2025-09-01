import express from "express";
import stripeService from "../services/stripe-service";
import PatientSchema from "../schemas/patient-schema";
import SubscriptionSchema from "../schemas/subscription-schema";
import { PatientT } from "../types/patient-type";
import Stripe from "stripe";

export const createCheckoutSession = async (req: express.Request, res: express.Response) => {
  try {
    const { planType } = req.body;
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!planType || !['lifestyle', 'medical'].includes(planType)) {
      return res.status(400).json({ error: 'Invalid plan type. Must be "lifestyle" or "medical"' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const successUrl = `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.FRONTEND_URL}/subscription/canceled`;

    let customerId = patient.stripeCustomerId;

    if (!customerId) {
      const customer = await stripeService.createCustomer(
        patient.email || `patient-${patient._id}@vidacure.com`,
        patient.name,
        {
          userId: userId.toString(),
          ssnHash: patient.ssnHash
        }
      );
      customerId = customer.id;
      
      patient.stripeCustomerId = customerId;
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
        ssnHash: patient.ssnHash
      }
    });

    res.json({ 
      sessionId: session.id, 
      url: session.url,
      customerId 
    });

  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getSubscriptionStatus = async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    let subscriptionData = null;

    if (patient.stripeSubscriptionId) {
      try {
        const subscription = await stripeService.retrieveSubscription(patient.stripeSubscriptionId);
        subscriptionData = {
          id: subscription.id,
          status: subscription.status,
          planType: patient.subscriptionPlanType,
          currentPeriodStart: new Date((subscription as any).current_period_start * 1000),
          currentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
          cancelAtPeriodEnd: (subscription as any).cancel_at_period_end
        };
      } catch (error) {
        console.error('Error fetching Stripe subscription:', error);
      }
    }

    res.json({
      hasSubscription: !!patient.stripeSubscriptionId,
      subscriptionStatus: patient.subscriptionStatus,
      planType: patient.subscriptionPlanType,
      subscription: subscriptionData
    });

  } catch (error: any) {
    console.error('Error getting subscription status:', error);
    res.status(500).json({ error: error.message });
  }
};

export const cancelSubscription = async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscription = await stripeService.cancelSubscription(patient.stripeSubscriptionId);

    patient.subscriptionStatus = 'canceled';
    patient.subscriptionEndDate = new Date((subscription as any).current_period_end * 1000);
    await patient.save();

    await SubscriptionSchema.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      { 
        status: 'canceled',
        canceledAt: new Date(),
        cancelAtPeriodEnd: (subscription as any).cancel_at_period_end
      }
    );

    res.json({ 
      message: 'Subscription canceled successfully',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        canceledAt: (subscription as any).canceled_at ? new Date((subscription as any).canceled_at * 1000) : undefined
      }
    });

  } catch (error: any) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: error.message });
  }
};

export const createPortalSession = async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient || !patient.stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer found' });
    }

    const returnUrl = `${process.env.FRONTEND_URL}/subscription`;
    const session = await stripeService.createPortalSession(patient.stripeCustomerId, returnUrl);

    res.json({ url: session.url });

  } catch (error: any) {
    console.error('Error creating portal session:', error);
    res.status(500).json({ error: error.message });
  }
};

export const handleSuccessfulPayment = async (session: Stripe.Checkout.Session) => {
  try {
    console.log('Processing successful payment for session:', session.id);

    const userId = session.metadata?.userId;
    if (!userId) {
      console.error('No userId found in session metadata');
      return;
    }

    const patient = await PatientSchema.findById(userId);
    if (!patient) {
      console.error('Patient not found for userId:', userId);
      return;
    }

    const subscriptionId = session.subscription as string;
    if (!subscriptionId) {
      console.error('No subscription found in session');
      return;
    }

    // Retrieve the full subscription object from Stripe
    const subscription = await stripeService.retrieveSubscription(subscriptionId);

    patient.stripeCustomerId = session.customer as string;
    patient.stripeSubscriptionId = subscription.id;
    patient.subscriptionStatus = subscription.status as PatientT['subscriptionStatus'];
    patient.subscriptionPlanType = session.metadata?.planType as PatientT['subscriptionPlanType'];
    
    const startTimestamp = (subscription as any).current_period_start;
    const endTimestamp = (subscription as any).current_period_end;
    
    patient.subscriptionStartDate = startTimestamp ? new Date(startTimestamp * 1000) : new Date();
    patient.subscriptionEndDate = endTimestamp ? new Date(endTimestamp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await patient.save();

    const subscriptionRecord = new SubscriptionSchema({
      userId: patient._id,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.items.data[0].price.id,
      stripeProductId: subscription.items.data[0].price.product as string,
      status: subscription.status,
      planType: session.metadata?.planType,
      currentPeriodStart: startTimestamp ? new Date(startTimestamp * 1000) : new Date(),
      currentPeriodEnd: endTimestamp ? new Date(endTimestamp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : undefined,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : undefined,
      metadata: session.metadata
    });

    await subscriptionRecord.save();

    console.log('Successfully processed payment for patient:', patient._id);

  } catch (error) {
    console.error('Error processing successful payment:', error);
  }
};

export const handleFailedPayment = async (session: Stripe.Checkout.Session) => {
  try {
    console.log('Processing failed payment for session:', session.id);
    
    const userId = session.metadata?.userId;
    if (userId) {
      const patient = await PatientSchema.findById(userId);
      if (patient) {
        patient.subscriptionStatus = 'unpaid';
        await patient.save();
      }
    }
  } catch (error) {
    console.error('Error processing failed payment:', error);
  }
};

export const handleSubscriptionUpdate = async (subscription: Stripe.Subscription) => {
  try {
    console.log('Processing subscription update:', subscription.id);

    const patient = await PatientSchema.findOne({ stripeSubscriptionId: subscription.id });
    if (!patient) {
      console.error('Patient not found for subscription:', subscription.id);
      return;
    }

    patient.subscriptionStatus = subscription.status as PatientT['subscriptionStatus'];
    
    const updateStartTimestamp = (subscription as any).current_period_start;
    const updateEndTimestamp = (subscription as any).current_period_end;
    
    patient.subscriptionStartDate = updateStartTimestamp ? new Date(updateStartTimestamp * 1000) : new Date();
    patient.subscriptionEndDate = updateEndTimestamp ? new Date(updateEndTimestamp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await patient.save();

    await SubscriptionSchema.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      {
        status: subscription.status,
        currentPeriodStart: updateStartTimestamp ? new Date(updateStartTimestamp * 1000) : new Date(),
        currentPeriodEnd: updateEndTimestamp ? new Date(updateEndTimestamp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      }
    );

    console.log('Successfully updated subscription for patient:', patient._id);

  } catch (error) {
    console.error('Error processing subscription update:', error);
  }
};

export const handleSubscriptionDeleted = async (subscription: Stripe.Subscription) => {
  try {
    console.log('Processing subscription deletion:', subscription.id);

    const patient = await PatientSchema.findOne({ stripeSubscriptionId: subscription.id });
    if (!patient) {
      console.error('Patient not found for subscription:', subscription.id);
      return;
    }

    patient.subscriptionStatus = 'canceled';
    patient.subscriptionEndDate = new Date();

    await patient.save();

    await SubscriptionSchema.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      {
        status: 'canceled',
        canceledAt: new Date()
      }
    );

    console.log('Successfully processed subscription deletion for patient:', patient._id);

  } catch (error) {
    console.error('Error processing subscription deletion:', error);
  }
};