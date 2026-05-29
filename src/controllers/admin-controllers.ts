import express from "express";
import crypto from "crypto";
import Stripe from "stripe";
import { Types } from "mongoose";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import ProviderSchema from "../schemas/provider-schema";
import AdminSchema from "../schemas/admin-schema";
import AuditLogSchema from "../schemas/auditLog-schema";
import LogReviewSchema from "../schemas/logReview-schema";
import { LOG_REVIEW_OUTCOMES, LOG_REVIEW_PARAMETERS } from "../types/log-review-type";
import type { LogReviewParameter } from "../types/log-review-type";
import stripeService from "../services/stripe-service";
import { hashSSN, isValidSwedishSSN } from "../services/auth-service";
import { getCalendlyUserByEmail, lookupCalendlyMemberByEmail } from "../services/calendly-service";
import { AdminAuthenticatedRequest } from "../middleware/admin-auth-middleware";
import { auditAdminAction } from "../middleware/audit-middleware";
import { notifyChatReassignDoctor } from "../services/chat-client-service";
import { LAB_TEST_PACKAGES } from "../config/lab-test-packages";
import { sendPaymentFailedEmail } from "../services/email-service";

/**
 * Get dashboard statistics
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const [totalPatients, totalDoctors, unassignedPatients, activeSubscriptions, pastDueSubscriptions, totalProviders] = await Promise.all([
      PatientSchema.countDocuments({}),
      DoctorSchema.countDocuments({}),
      PatientSchema.countDocuments({ doctor: { $exists: false } }),
      PatientSchema.countDocuments({
        'subscription.status': 'active'
      }),
      PatientSchema.countDocuments({
        'subscription.status': 'past_due'
      }),
      ProviderSchema.countDocuments({ isActive: true })
    ]);

    await auditAdminAction(req, 'admin_get_dashboard_stats', 'READ', true);

    res.json({
      totalPatients,
      totalDoctors,
      unassignedPatients,
      activeSubscriptions,
      pastDueSubscriptions,
      totalProviders
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_dashboard_stats', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all patients with doctor info
 * GET /api/admin/patients?page=1&limit=20&includeStripeData=true
 */
export const getAllPatients = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const includeStripeData = req.query.includeStripeData === 'true';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;

    const validStatuses = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired'];
    const query: Record<string, any> = {};
    if (statusFilter && validStatuses.includes(statusFilter)) {
      query['subscription.status'] = statusFilter;
    } else if (statusFilter === 'none') {
      query['subscription.status'] = { $in: [null, undefined] };
    }

    const [patients, totalCount] = await Promise.all([
      PatientSchema.find(query)
        .populate('doctor', 'name email _id')
        .select('name email doctor subscription lastLogin createdAt calendly hasCompletedOnboarding')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      PatientSchema.countDocuments(query)
    ]);

    // If includeStripeData is true, fetch real-time data from Stripe for each patient
    let enrichedPatients: any[] = patients.map(p => p.toObject());
    if (includeStripeData) {
      enrichedPatients = await Promise.all(
        patients.map(async (patient) => {
          const patientObj = patient.toObject();

          // Only fetch Stripe data if patient has an active subscription
          if (patientObj.subscription?.stripeSubscriptionId) {
            try {
              const [stripeSubscription, paymentMethod, upcomingInvoice] = await Promise.all([
                stripeService.getDetailedSubscriptionInfo(patientObj.subscription.stripeSubscriptionId),
                patientObj.subscription.stripeCustomerId
                  ? stripeService.getCustomerDefaultPaymentMethod(patientObj.subscription.stripeCustomerId)
                  : null,
                patientObj.subscription.stripeCustomerId
                  ? stripeService.getUpcomingInvoice(patientObj.subscription.stripeCustomerId)
                  : null
              ]);

              return {
                ...patientObj,
                stripeData: {
                  subscription: stripeSubscription,
                  paymentMethod: paymentMethod,
                  upcomingInvoice: upcomingInvoice
                }
              };
            } catch (error) {
              console.error(`Error fetching Stripe data for patient ${patient._id}:`, error);
              return patientObj;
            }
          }

          return patientObj;
        })
      );
    }

    await auditAdminAction(req, 'admin_get_all_patients', 'READ', true, undefined, { page, limit, totalCount });

    res.json({
      patients: enrichedPatients,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_all_patients', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all doctors with patient details
 * GET /api/admin/doctors
 */
export const getAllDoctors = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const doctors = await DoctorSchema.find({})
      .populate('patients', 'name email subscription.status subscription.planType lastLogin')
      .select('name email patients assignedChannels lastLogin createdAt')
      .sort({ createdAt: -1 });

    const doctorsWithStats = doctors.map(doctor => ({
      _id: doctor._id,
      name: doctor.name,
      email: doctor.email,
      lastLogin: doctor.lastLogin,
      createdAt: doctor.createdAt,
      patientCount: doctor.patients?.length || 0,
      channelCount: doctor.assignedChannels?.length || 0,
      patients: doctor.patients
    }));

    await auditAdminAction(req, 'admin_get_all_doctors', 'READ', true, undefined, { count: doctorsWithStats.length });

    res.json({
      doctors: doctorsWithStats
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_all_doctors', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Manually send the "payment failed" email to a patient.
 * POST /api/admin/patients/:patientId/send-payment-failed-email
 */
export const sendPaymentFailedEmailManual = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId } = req.params;

    const patient = await PatientSchema.findById(patientId)
      .select('email subscription')
      .lean();

    if (!patient) {
      await auditAdminAction(req, 'admin_send_payment_failed_email', 'UPDATE', false, patientId, { reason: 'patient_not_found' });
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Admin may override the recipient; otherwise fall back to the patient's email on file.
    const overrideEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const recipient = overrideEmail || patient.email;

    if (!recipient) {
      await auditAdminAction(req, 'admin_send_payment_failed_email', 'UPDATE', false, patientId, { reason: 'no_email' });
      return res.status(400).json({ error: 'No recipient email provided and patient has none on file' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      await auditAdminAction(req, 'admin_send_payment_failed_email', 'UPDATE', false, patientId, { reason: 'invalid_email' });
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Amount is intentionally nullable. We only fill it when we can read a
    // figure that already reflects the customer's coupons/discounts. If we
    // can't, we leave it null and the email omits the number entirely rather
    // than showing the misleading list price.
    let amount: string | null = null;
    let currency: string | null = null;
    let hostedInvoiceUrl: string | null = null;

    const customerId = patient.subscription?.stripeCustomerId;

    if (customerId) {
      // 1. Prefer the actual open/failed invoice — amount_due reflects discounts.
      try {
        const invoices = await stripeService.getCustomerInvoices(customerId);
        const latestOpenOrFailed = invoices.find(
          (inv) => inv.status === 'open' || inv.status === 'uncollectible'
        );
        if (latestOpenOrFailed) {
          amount = ((latestOpenOrFailed.amount_due ?? 0) / 100).toFixed(2);
          currency = (latestOpenOrFailed.currency || 'sek').toUpperCase();
          if (latestOpenOrFailed.hosted_invoice_url) {
            hostedInvoiceUrl = latestOpenOrFailed.hosted_invoice_url;
          }
        }
      } catch (err) {
        console.warn('Could not fetch invoices for manual payment failed email:', err);
      }

      // 2. No failed invoice on record — fall back to the upcoming invoice
      //    preview, which also honors the coupon (createPreview applies discounts).
      if (amount === null) {
        try {
          const upcoming = await stripeService.getUpcomingInvoice(customerId);
          if (upcoming) {
            amount = ((upcoming.amount_due ?? upcoming.total ?? 0) / 100).toFixed(2);
            currency = (upcoming.currency || 'sek').toUpperCase();
          }
        } catch (err) {
          console.warn('Could not fetch upcoming invoice for manual payment failed email:', err);
        }
      }
    }

    // 3. Nothing reliable resolved (e.g. canceled sub, no Stripe customer) —
    //    send without an amount; the email falls back to generic wording.

    await sendPaymentFailedEmail({
      to: recipient,
      amount,
      currency,
      hostedInvoiceUrl,
    });

    await auditAdminAction(req, 'admin_send_payment_failed_email', 'UPDATE', true, patientId, { email: recipient, overridden: !!overrideEmail });

    res.json({ success: true, message: 'Payment failed email sent', sentTo: recipient });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_send_payment_failed_email', 'UPDATE', false, req.params.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Reassign patient to a new doctor
 * POST /api/admin/reassign-doctor
 * Body: { patientId: string, newDoctorId: string }
 */
export const reassignDoctor = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId, newDoctorId } = req.body;

    if (!patientId || !newDoctorId) {
      return res.status(400).json({ error: 'patientId and newDoctorId are required' });
    }

    // Get patient to find old doctor
    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Verify new doctor exists
    const newDoctor = await DoctorSchema.findById(newDoctorId);
    if (!newDoctor) {
      return res.status(404).json({ error: 'New doctor not found' });
    }

    const oldDoctorId = patient.doctor?.toString();

    // Check if patient already has this doctor
    if (oldDoctorId === newDoctorId) {
      return res.status(400).json({ error: 'Patient is already assigned to this doctor' });
    }

    // Update MongoDB relations
    if (oldDoctorId) {
      await DoctorSchema.findByIdAndUpdate(oldDoctorId, {
        $pull: { patients: patientId },
      });
    }

    await PatientSchema.findByIdAndUpdate(patientId, {
      doctor: newDoctorId,
    });

    await DoctorSchema.findByIdAndUpdate(newDoctorId, {
      $addToSet: { patients: patientId },
    });

    // Notify chat server to update conversation and broadcast events
    await notifyChatReassignDoctor(patientId, newDoctorId);

    // Fetch updated patient and doctor info (select only admin-safe fields, no health data)
    const [updatedPatient, updatedNewDoctor, updatedOldDoctor] = await Promise.all([
      PatientSchema.findById(patientId)
        .select('name email doctor subscription lastLogin createdAt')
        .populate('doctor', 'name email'),
      DoctorSchema.findById(newDoctorId).select('name email patients assignedChannels'),
      oldDoctorId ? DoctorSchema.findById(oldDoctorId).select('name email patients assignedChannels') : null
    ]);

    await auditAdminAction(req, 'admin_reassign_doctor', 'UPDATE', true, patientId, { patientId, newDoctorId, oldDoctorId });

    res.json({
      message: 'Doctor reassigned successfully',
      patient: updatedPatient,
      newDoctor: updatedNewDoctor,
      oldDoctor: updatedOldDoctor
    });

  } catch (error: any) {
    await auditAdminAction(req, 'admin_reassign_doctor', 'UPDATE', false, req.body?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get unassigned patients
 * GET /api/admin/unassigned-patients
 */
export const getUnassignedPatients = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const unassignedPatients = await PatientSchema.find({
      doctor: { $exists: false }
    })
      .select('name email subscription.status subscription.planType lastLogin createdAt')
      .sort({ createdAt: -1 });

    await auditAdminAction(req, 'admin_get_unassigned_patients', 'READ', true, undefined, { count: unassignedPatients.length });

    res.json({
      patients: unassignedPatients,
      count: unassignedPatients.length
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_unassigned_patients', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get detailed subscription information for a specific patient
 * GET /api/admin/patients/:patientId/subscription-details
 */
export const getPatientSubscriptionDetails = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId } = req.params;

    const patient = await PatientSchema.findById(patientId)
      .select('name email subscription')
      .populate('doctor', 'name email');

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const patientObj = patient.toObject();

    // If patient doesn't have a subscription
    if (!patientObj.subscription?.stripeSubscriptionId) {
      return res.json({
        patient: patientObj,
        stripeData: null,
        message: 'No active subscription found'
      });
    }

    // Fetch detailed Stripe data
    try {
      const [stripeSubscription, paymentMethod, upcomingInvoice, paymentMethods, invoices] = await Promise.all([
        stripeService.getDetailedSubscriptionInfo(patientObj.subscription.stripeSubscriptionId),
        patientObj.subscription.stripeCustomerId
          ? stripeService.getCustomerDefaultPaymentMethod(patientObj.subscription.stripeCustomerId)
          : null,
        patientObj.subscription.stripeCustomerId
          ? stripeService.getUpcomingInvoice(patientObj.subscription.stripeCustomerId)
          : null,
        patientObj.subscription.stripeCustomerId
          ? stripeService.getCustomerPaymentMethods(patientObj.subscription.stripeCustomerId)
          : [],
        patientObj.subscription.stripeCustomerId
          ? stripeService.getCustomerInvoices(patientObj.subscription.stripeCustomerId)
          : []
      ]);

      await auditAdminAction(req, 'admin_get_patient_subscription', 'READ', true, patientId);

      res.json({
        patient: patientObj,
        stripeData: {
          subscription: stripeSubscription,
          defaultPaymentMethod: paymentMethod,
          upcomingInvoice: upcomingInvoice,
          allPaymentMethods: paymentMethods,
          invoices: invoices.map((inv: any) => ({
            id: inv.id,
            number: inv.number,
            status: inv.status,
            amount_due: inv.amount_due,
            amount_paid: inv.amount_paid,
            currency: inv.currency,
            created: inv.created,
            period_start: inv.lines?.data?.[0]?.period?.start || inv.period_start,
            period_end: inv.lines?.data?.[0]?.period?.end || inv.period_end,
            invoice_pdf: inv.invoice_pdf,
            hosted_invoice_url: inv.hosted_invoice_url,
          }))
        }
      });
    } catch (error: any) {
      await auditAdminAction(req, 'admin_get_patient_subscription', 'READ', false, patientId, undefined, error);
      res.status(500).json({
        error: 'Failed to fetch Stripe subscription details',
        details: error.message
      });
    }
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_patient_subscription', 'READ', false, req.params?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Check if SSN exists in Doctor or Patient collections
 * POST /api/admin/check-ssn
 * Body: { ssn: string }
 */
export const checkSSN = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { ssn } = req.body;

    if (!ssn) {
      return res.status(400).json({ error: 'SSN is required' });
    }

    // Validate SSN format
    if (!isValidSwedishSSN(ssn)) {
      return res.status(400).json({ error: 'Invalid Swedish SSN format. Must be 12 digits (YYYYMMDDXXXX)' });
    }

    // Hash the SSN
    const ssnHash = hashSSN(ssn);

    // Check if exists in Doctor collection
    const existingDoctor = await DoctorSchema.findOne({ ssnHash }).select('name');
    if (existingDoctor) {
      return res.json({
        exists: true,
        type: 'doctor',
        doctorName: existingDoctor.name
      });
    }

    // Check if exists in Patient collection
    const existingPatient = await PatientSchema.findOne({ ssnHash }).select('_id name');
    if (existingPatient) {
      return res.json({
        exists: true,
        type: 'patient',
        patientId: existingPatient._id,
        patientName: existingPatient.name
      });
    }

    await auditAdminAction(req, 'admin_check_ssn', 'READ', true);

    // SSN is available
    res.json({
      exists: false
    });

  } catch (error: any) {
    await auditAdminAction(req, 'admin_check_ssn', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Convert patient to doctor
 * POST /api/admin/convert-patient-to-doctor
 * Body: { patientId: string, email: string }
 */
export const convertPatientToDoctor = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId, email } = req.body;

    // Validate required fields
    if (!patientId || !email) {
      return res.status(400).json({ error: 'Patient ID and email are required' });
    }

    // Find patient (only need ssnHash and doctor ref for conversion)
    const patient = await PatientSchema.findById(patientId).select('ssnHash doctor name');
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const ssnHash = patient.ssnHash;

    // Check if email already exists in Doctor collection
    const existingDoctorEmail = await DoctorSchema.findOne({ email });
    if (existingDoctorEmail) {
      return res.status(409).json({ error: 'This email is already registered to another doctor' });
    }

    // Create new doctor with same ssnHash
    // Name fields will be populated from BankID on first login
    const newDoctor = new DoctorSchema({
      ssnHash,
      name: 'Pending BankID Login',
      given_name: 'Pending',
      family_name: 'BankID',
      email,
      role: 'doctor',
      patients: [],
      assignedChannels: [],
    });

    const savedDoctor = await newDoctor.save();

    // Eagerly resolve Calendly user URI by email
    try {
      const calendlyUserUri = await getCalendlyUserByEmail(email);
      if (calendlyUserUri) {
        savedDoctor.calendlyUserUri = calendlyUserUri;
        await savedDoctor.save();
      }
    } catch (err) {
      console.warn('Could not resolve Calendly user for converted doctor:', err);
    }

    // If patient was assigned to a doctor, remove from that doctor's patients array
    if (patient.doctor) {
      await DoctorSchema.findByIdAndUpdate(
        patient.doctor,
        { $pull: { patients: patientId } }
      );
    }

    // Delete patient record
    await PatientSchema.findByIdAndDelete(patientId);

    await auditAdminAction(req, 'admin_convert_patient_to_doctor', 'UPDATE', true, patientId, { newDoctorId: savedDoctor._id?.toString() });

    res.status(201).json({
      message: 'Patient successfully converted to doctor. Name will be updated on first BankID login.',
      doctor: {
        _id: savedDoctor._id,
        email: savedDoctor.email,
        createdAt: savedDoctor.createdAt
      }
    });

  } catch (error: any) {
    await auditAdminAction(req, 'admin_convert_patient_to_doctor', 'UPDATE', false, req.body?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Add a new doctor
 * POST /api/admin/add-doctor
 * Body: { ssn: string, email: string }
 */
export const addDoctor = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { ssn, email, eventTypes } = req.body;

    // Validate required fields
    if (!ssn || !email) {
      return res.status(400).json({ error: 'SSN and email are required' });
    }

    // Validate SSN format
    if (!isValidSwedishSSN(ssn)) {
      return res.status(400).json({ error: 'Invalid Swedish SSN format. Must be 12 digits (YYYYMMDDXXXX)' });
    }

    // Hash the SSN
    const ssnHash = hashSSN(ssn);

    // Check if doctor already exists with this SSN
    const existingDoctor = await DoctorSchema.findOne({ ssnHash });
    if (existingDoctor) {
      return res.status(409).json({ error: 'Doctor with this SSN already exists' });
    }

    // Check if email already exists
    const existingEmail = await DoctorSchema.findOne({ email });
    if (existingEmail) {
      return res.status(409).json({ error: 'Doctor with this email already exists' });
    }

    // Check if this SSN is already a patient
    const existingPatient = await PatientSchema.findOne({ ssnHash });
    if (existingPatient) {
      return res.status(409).json({
        error: 'This SSN is already registered as a patient. Please use the convert function instead.'
      });
    }

    // Create new doctor with placeholder name that will be updated from BankID on first login
    const newDoctor = new DoctorSchema({
      ssnHash,
      name: 'Pending BankID Login',
      given_name: 'Pending',
      family_name: 'BankID',
      email,
      role: 'doctor',
      patients: [],
      assignedChannels: [],
      ...(eventTypes && { eventTypes }),
    });

    const savedDoctor = await newDoctor.save();

    // Eagerly resolve Calendly user URI by email
    let calendlyLinked = false;
    try {
      const calendlyUserUri = await getCalendlyUserByEmail(email);
      if (calendlyUserUri) {
        savedDoctor.calendlyUserUri = calendlyUserUri;
        await savedDoctor.save();
        calendlyLinked = true;
      }
    } catch (err) {
      console.warn('Could not resolve Calendly user for new doctor:', err);
    }

    await auditAdminAction(req, 'admin_add_doctor', 'CREATE', true, savedDoctor._id?.toString(), { email, calendlyLinked });

    res.status(201).json({
      message: `Doctor created successfully.${calendlyLinked ? ' Calendly account linked.' : ' No Calendly account found for this email.'} Name will be populated from BankID on first login.`,
      doctor: {
        _id: savedDoctor._id,
        email: savedDoctor.email,
        createdAt: savedDoctor.createdAt,
        calendlyLinked
      }
    });

  } catch (error: any) {
    await auditAdminAction(req, 'admin_add_doctor', 'CREATE', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Provider Management ============

/**
 * Add a new provider
 * POST /api/admin/providers
 * Body: { name, email, providerType, specialty?, bio?, eventTypes?, adminNotes? }
 */
export const addProvider = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { name, email, providerType, specialty, bio, eventTypes, adminNotes } = req.body;

    if (!name || !email || !providerType) {
      return res.status(400).json({ error: 'name, email, and providerType are required' });
    }

    // Check email uniqueness across collections
    const [existingProvider, existingDoctor, existingPatient] = await Promise.all([
      ProviderSchema.findOne({ email }),
      DoctorSchema.findOne({ email }),
      PatientSchema.findOne({ email }),
    ]);

    if (existingProvider) {
      return res.status(409).json({ error: 'A provider with this email already exists' });
    }
    if (existingDoctor) {
      return res.status(409).json({ error: 'This email is already registered to a doctor' });
    }
    if (existingPatient) {
      return res.status(409).json({ error: 'This email is already registered to a patient' });
    }

    const newProvider = new ProviderSchema({
      name,
      email,
      providerType,
      specialty,
      bio,
      adminNotes,
      ...(eventTypes && { eventTypes }),
    });

    const savedProvider = await newProvider.save();

    // Eagerly resolve Calendly user URI
    let calendlyLinked = false;
    try {
      const calendlyUserUri = await getCalendlyUserByEmail(email);
      if (calendlyUserUri) {
        savedProvider.calendlyUserUri = calendlyUserUri;
        await savedProvider.save();
        calendlyLinked = true;
      }
    } catch (err) {
      console.warn('Could not resolve Calendly user for new provider:', err);
    }

    await auditAdminAction(req, 'admin_add_provider', 'CREATE', true, savedProvider._id?.toString(), { name, email, providerType });

    res.status(201).json({
      message: `Provider created successfully.${calendlyLinked ? ' Calendly account linked.' : ' No Calendly account found for this email.'}`,
      provider: savedProvider,
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_add_provider', 'CREATE', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all providers (including inactive)
 * GET /api/admin/providers
 */
export const getAllProviders = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const providers = await ProviderSchema.find({})
      .sort({ createdAt: -1 });

    // Get patient count for each provider
    const providersWithStats = await Promise.all(
      providers.map(async (provider) => {
        const patientCount = await PatientSchema.countDocuments({
          providers: provider._id,
        });
        return {
          ...provider.toObject(),
          patientCount,
        };
      })
    );

    await auditAdminAction(req, 'admin_get_all_providers', 'READ', true, undefined, { count: providersWithStats.length });

    res.json({ providers: providersWithStats });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_all_providers', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update a provider
 * PUT /api/admin/providers/:providerId
 */
export const updateProvider = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { providerId } = req.params;
    const updates = req.body;

    // Don't allow changing _id
    delete updates._id;

    const provider = await ProviderSchema.findByIdAndUpdate(
      providerId,
      { $set: updates },
      { new: true }
    );

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    await auditAdminAction(req, 'admin_update_provider', 'UPDATE', true, providerId);

    res.json({ provider });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_update_provider', 'UPDATE', false, req.params?.providerId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Deactivate a provider (soft delete)
 * DELETE /api/admin/providers/:providerId
 */
export const deactivateProvider = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { providerId } = req.params;

    const provider = await ProviderSchema.findByIdAndUpdate(
      providerId,
      { isActive: false },
      { new: true }
    );

    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    await auditAdminAction(req, 'admin_deactivate_provider', 'DELETE', true, providerId);

    res.json({ message: 'Provider deactivated successfully', provider });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_deactivate_provider', 'DELETE', false, req.params?.providerId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Provider Tier Overrides ============

/**
 * Set a provider tier override for a patient
 * POST /api/admin/provider-tier-override
 * Body: { patientId, providerId, tier: "free" | "premium" }
 */
export const setProviderTierOverride = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId, providerId, tier } = req.body;

    if (!patientId || !providerId || !tier) {
      return res.status(400).json({ error: 'patientId, providerId, and tier are required' });
    }

    if (!['free', 'premium'].includes(tier)) {
      return res.status(400).json({ error: 'tier must be "free" or "premium"' });
    }

    const [patient, provider] = await Promise.all([
      PatientSchema.findById(patientId).select('name providerTierOverrides'),
      ProviderSchema.findById(providerId),
    ]);

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    // Upsert: update existing override or push new one
    const existingIndex = (patient.providerTierOverrides || []).findIndex(
      (o: any) => o.providerId.toString() === providerId
    );

    if (existingIndex >= 0) {
      patient.providerTierOverrides![existingIndex].tier = tier;
      patient.providerTierOverrides![existingIndex].setBy = 'admin';
      patient.providerTierOverrides![existingIndex].setAt = new Date();
    } else {
      if (!patient.providerTierOverrides) {
        patient.providerTierOverrides = [];
      }
      patient.providerTierOverrides.push({
        providerId: provider._id,
        tier,
        setBy: 'admin',
        setAt: new Date(),
      } as any);
    }

    await patient.save();

    await auditAdminAction(req, 'admin_set_tier_override', 'UPDATE', true, patientId, { providerId, tier });

    res.json({
      message: `Tier override set to "${tier}" for provider "${provider.name}" on patient "${patient.name}"`,
      patientId,
      providerId,
      tier,
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_set_tier_override', 'UPDATE', false, req.body?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Remove a provider tier override for a patient (revert to default)
 * POST /api/admin/remove-provider-tier-override
 * Body: { patientId, providerId }
 */
export const removeProviderTierOverride = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId, providerId } = req.body;

    if (!patientId || !providerId) {
      return res.status(400).json({ error: 'patientId and providerId are required' });
    }

    const patient = await PatientSchema.findById(patientId).select('name');
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    await PatientSchema.findByIdAndUpdate(patientId, {
      $pull: { providerTierOverrides: { providerId } },
    });

    await auditAdminAction(req, 'admin_remove_tier_override', 'DELETE', true, patientId, { providerId });

    res.json({
      message: 'Tier override removed, reverted to default logic',
      patientId,
      providerId,
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_remove_tier_override', 'DELETE', false, req.body?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all active providers with resolved tiers for a specific patient
 * GET /api/admin/patients/:patientId/provider-tiers
 */
export const getPatientProviderTiers = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { patientId } = req.params;

    const [patient, allActiveProviders] = await Promise.all([
      PatientSchema.findById(patientId).select('name subscription providerTierOverrides'),
      ProviderSchema.find({ isActive: true }).sort({ createdAt: -1 }),
    ]);

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const { resolveProviderTier } = await import('../services/tier-resolution-service');

    const patientPlanType = patient.subscription?.planType;
    const overrides = patient.providerTierOverrides || [];

    const providersWithTiers = allActiveProviders.map((provider) => {
      const { tier, source } = resolveProviderTier({
        providerId: provider._id.toString(),
        providerType: provider.providerType,
        patientPlanType,
        overrides,
      });

      return {
        _id: provider._id,
        name: provider.name,
        email: provider.email,
        providerType: provider.providerType,
        specialty: provider.specialty,
        tier,
        source,
      };
    });

    await auditAdminAction(req, 'admin_get_patient_tiers', 'READ', true, patientId);

    res.json({
      patientId,
      patientName: patient.name,
      patientPlanType: patientPlanType || null,
      providers: providersWithTiers,
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_get_patient_tiers', 'READ', false, req.params?.patientId, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Calendly Lookup ============

/**
 * Lookup a Calendly organization member by email
 * POST /api/admin/calendly-lookup
 * Body: { email }
 * Returns user profile (name, avatar, scheduling_url) + active event types
 */
export const calendlyLookup = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const result = await lookupCalendlyMemberByEmail(email);

    if (!result) {
      return res.status(404).json({
        error: 'No Calendly user found with this email',
        message: 'Make sure this email is added to your Calendly organization first.',
      });
    }

    await auditAdminAction(req, 'admin_calendly_lookup', 'READ', true, undefined, { email });

    res.json({
      found: true,
      user: {
        name: result.user.name,
        email: result.user.email,
        avatarUrl: result.user.avatar_url,
        schedulingUrl: result.user.scheduling_url,
        timezone: result.user.timezone,
        uri: result.user.uri,
      },
      eventTypes: result.eventTypes.map(et => ({
        uri: et.uri,
        name: et.name,
        slug: et.slug,
        duration: et.duration,
        schedulingUrl: et.scheduling_url,
        active: et.active,
      })),
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_calendly_lookup', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Promotion / Coupon Management ============

/**
 * Create a coupon + promotion code in Stripe
 * POST /api/admin/promotions
 * Body: { code, name, discountType, percentOff?, amountOff?, duration, durationInMonths?, maxRedemptions?, expiresAt? }
 */
export const createPromotion = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { code, name, discountType, percentOff, amountOff, duration, durationInMonths, maxRedemptions, expiresAt, appliesTo } = req.body;

    if (!code || !name || !discountType || !duration) {
      return res.status(400).json({ error: 'code, name, discountType, and duration are required' });
    }

    const validAppliesTo = ['all', 'subscriptions', 'lab_tests'];
    const resolvedAppliesTo = validAppliesTo.includes(appliesTo) ? appliesTo : 'all';

    if (discountType === 'percent' && (!percentOff || percentOff < 1 || percentOff > 100)) {
      return res.status(400).json({ error: 'percentOff must be between 1 and 100' });
    }

    if (discountType === 'fixed' && (!amountOff || amountOff < 1)) {
      return res.status(400).json({ error: 'amountOff must be a positive number (SEK)' });
    }

    if (duration === 'repeating' && (!durationInMonths || durationInMonths < 1)) {
      return res.status(400).json({ error: 'durationInMonths is required for repeating duration' });
    }

    // Resolve product restrictions based on appliesTo (set on coupon, not promo code)
    let appliesToProductIds: string[] | undefined;
    if (resolvedAppliesTo === 'subscriptions') {
      appliesToProductIds = await stripeService.getSubscriptionProductIds();
    }
    // Note: 'lab_tests' uses metadata label only — Stripe can't restrict to inline products

    // Create the coupon in Stripe (with product restriction if applicable)
    const coupon = await stripeService.createCoupon({
      name,
      percentOff: discountType === 'percent' ? percentOff : undefined,
      amountOff: discountType === 'fixed' ? Math.round(amountOff * 100) : undefined, // Convert SEK to öre
      currency: discountType === 'fixed' ? 'sek' : undefined,
      duration,
      durationInMonths: duration === 'repeating' ? durationInMonths : undefined,
      maxRedemptions: maxRedemptions || undefined,
      appliesToProductIds,
    });

    // Create the promotion code referencing the coupon
    const promoCode = await stripeService.createPromotionCode({
      couponId: coupon.id,
      code: code.toUpperCase(),
      maxRedemptions: maxRedemptions || undefined,
      expiresAt: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined,
      metadata: { appliesTo: resolvedAppliesTo },
    });

    await auditAdminAction(req, 'admin_create_promotion', 'CREATE', true, undefined, { code: promoCode.code, couponId: coupon.id, appliesTo: resolvedAppliesTo });

    res.status(201).json({
      message: 'Promotion code created successfully',
      promotion: {
        id: promoCode.id,
        code: promoCode.code,
        active: promoCode.active,
        coupon: {
          id: coupon.id,
          name: coupon.name,
          percentOff: coupon.percent_off,
          amountOff: coupon.amount_off ? coupon.amount_off / 100 : null, // Convert öre back to SEK
          currency: coupon.currency,
          duration: coupon.duration,
          durationInMonths: coupon.duration_in_months,
          valid: coupon.valid,
        },
        maxRedemptions: promoCode.max_redemptions,
        timesRedeemed: promoCode.times_redeemed,
        expiresAt: promoCode.expires_at ? new Date(promoCode.expires_at * 1000).toISOString() : null,
        created: new Date(promoCode.created * 1000).toISOString(),
        appliesTo: resolvedAppliesTo,
      },
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_create_promotion', 'CREATE', false, undefined, undefined, error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

/**
 * List promotion codes from Stripe with cursor pagination
 * GET /api/admin/promotions?active=true&startingAfter=xxx&limit=25
 */
export const listPromotions = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const active = req.query.active !== undefined ? req.query.active === 'true' : undefined;
    const startingAfter = req.query.startingAfter as string | undefined;
    const limit = parseInt(req.query.limit as string) || 25;

    const result = await stripeService.listPromotionCodes({
      active,
      startingAfter,
      limit,
    });

    const promotions = result.data.map((pc) => {
      const coupon = pc.coupon as Stripe.Coupon;
      return {
        id: pc.id,
        code: pc.code,
        active: pc.active,
        coupon: {
          id: coupon.id,
          name: coupon.name,
          percentOff: coupon.percent_off,
          amountOff: coupon.amount_off ? coupon.amount_off / 100 : null,
          currency: coupon.currency,
          duration: coupon.duration,
          durationInMonths: coupon.duration_in_months,
          valid: coupon.valid,
        },
        maxRedemptions: pc.max_redemptions,
        timesRedeemed: pc.times_redeemed,
        expiresAt: pc.expires_at ? new Date(pc.expires_at * 1000).toISOString() : null,
        created: new Date(pc.created * 1000).toISOString(),
        appliesTo: (pc.metadata?.appliesTo as string) || 'all',
      };
    });

    await auditAdminAction(req, 'admin_list_promotions', 'READ', true, undefined, { count: promotions.length });

    res.json({
      promotions,
      hasMore: result.has_more,
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_list_promotions', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Deactivate a promotion code in Stripe
 * POST /api/admin/promotions/:promoCodeId/deactivate
 */
export const deactivatePromotion = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { promoCodeId } = req.params;

    const updated = await stripeService.deactivatePromotionCode(promoCodeId);

    await auditAdminAction(req, 'admin_deactivate_promotion', 'UPDATE', true, undefined, { promoCodeId, code: updated.code });

    res.json({
      message: 'Promotion code deactivated successfully',
      promotion: {
        id: updated.id,
        code: updated.code,
        active: updated.active,
      },
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_deactivate_promotion', 'UPDATE', false, undefined, undefined, error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

/**
 * Get current subscription products from Stripe and lab test packages from config
 * GET /api/admin/subscription-products
 */
export const getSubscriptionProducts = async (_req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const products = await stripeService.getSubscriptionProductDetails();
    const labTestPackages = LAB_TEST_PACKAGES.map((pkg) => ({
      name: pkg.name,
      unitAmount: pkg.priceAmountOre,
      currency: pkg.priceCurrency,
    }));
    res.json({ products, labTestPackages });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ============ Audit Log Review (PDL Compliance) ============

/**
 * Get audit logs with filters for systematic review
 * GET /api/admin/audit-logs?page=1&limit=50&userId=&targetId=&action=&dateFrom=&dateTo=&success=
 */
export const getAuditLogs = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const skip = (page - 1) * limit;

    // Build filter
    const filter: any = {};
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.targetId) filter.targetId = req.query.targetId;
    if (req.query.action) filter.action = { $regex: req.query.action, $options: 'i' };
    if (req.query.role) filter.role = req.query.role;
    if (req.query.success !== undefined) filter.success = req.query.success === 'true';
    if (req.query.dateFrom || req.query.dateTo) {
      filter.timestamp = {};
      if (req.query.dateFrom) filter.timestamp.$gte = new Date(req.query.dateFrom as string);
      if (req.query.dateTo) filter.timestamp.$lte = new Date(req.query.dateTo as string);
    }

    const [logs, totalCount] = await Promise.all([
      AuditLogSchema.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLogSchema.countDocuments(filter),
    ]);

    // Attach display names for accessor + target (read-only batched lookup).
    const nameMap = await resolveUserNames([
      ...logs.map((l: any) => l.userId),
      ...logs.map((l: any) => l.targetId),
    ]);
    const enrichedLogs = logs.map((l: any) => ({
      ...l,
      userName: nameMap[String(l.userId)],
      targetName: l.targetId ? nameMap[String(l.targetId)] : undefined,
    }));

    await auditAdminAction(req, 'admin_view_audit_logs', 'READ', true, undefined, { page, filters: Object.keys(filter) });

    res.json({
      logs: enrichedLogs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_view_audit_logs', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Resolve a set of user ObjectIds to display names (read-only).
 * Accessors may be doctors/admins; targets are patients — query all three collections.
 */
async function resolveUserNames(ids: any[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
  if (unique.length === 0) return {};
  const objIds = unique
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const [patients, doctors, admins] = await Promise.all([
    PatientSchema.find({ _id: { $in: objIds } }).select('name').lean(),
    DoctorSchema.find({ _id: { $in: objIds } }).select('name').lean(),
    AdminSchema.find({ _id: { $in: objIds } }).select('name').lean(),
  ]);

  const map: Record<string, string> = {};
  for (const u of [...patients, ...doctors, ...admins]) {
    map[String((u as any)._id)] = (u as any).name;
  }
  return map;
}

/**
 * Get anomaly detection summary
 * GET /api/admin/audit-logs/anomalies
 * Flags: high-volume access by single user, failed access clusters, unusual hours
 */
export const getAuditAnomalies = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7); // Last 7 days

    // Users accessing many different patients (exclude self-access)
    const highVolumeAccessors = await AuditLogSchema.aggregate([
      { $match: { timestamp: { $gte: since }, targetId: { $exists: true }, $expr: { $ne: ['$userId', '$targetId'] } } },
      { $group: { _id: '$userId', uniqueTargets: { $addToSet: '$targetId' }, totalAccess: { $sum: 1 } } },
      { $project: { userId: '$_id', uniqueTargetCount: { $size: '$uniqueTargets' }, totalAccess: 1 } },
      { $match: { uniqueTargetCount: { $gt: 20 } } },
      { $sort: { uniqueTargetCount: -1 } },
      { $limit: 10 },
    ]);

    // Failed access clusters
    const failedAccessClusters = await AuditLogSchema.aggregate([
      { $match: { timestamp: { $gte: since }, success: false } },
      { $group: { _id: { userId: '$userId', action: '$action' }, count: { $sum: 1 }, latestAttempt: { $max: '$timestamp' } } },
      { $match: { count: { $gt: 5 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Access outside business hours (before 7 AM or after 7 PM CET)
    // Patients accessing their own data is never "unauthorized" — only staff (doctor/admin) is relevant.
    const afterHoursAccess = await AuditLogSchema.aggregate([
      { $match: { timestamp: { $gte: since }, role: { $ne: 'patient' } } },
      { $project: { hour: { $hour: { date: '$timestamp', timezone: 'Europe/Stockholm' } }, userId: 1, action: 1, timestamp: 1 } },
      { $match: { $or: [{ hour: { $lt: 7 } }, { hour: { $gte: 19 } }] } },
      { $group: { _id: '$userId', afterHoursCount: { $sum: 1 } } },
      { $match: { afterHoursCount: { $gt: 10 } } },
      { $sort: { afterHoursCount: -1 } },
      { $limit: 10 },
    ]);

    // Repeated access to a SINGLE patient by one staff member (snooping signal); exclude self-access
    const singlePatientFrequency = await AuditLogSchema.aggregate([
      { $match: { timestamp: { $gte: since }, role: { $ne: 'patient' }, targetId: { $exists: true }, $expr: { $ne: ['$userId', '$targetId'] } } },
      { $group: { _id: { userId: '$userId', targetId: '$targetId' }, count: { $sum: 1 }, latestAccess: { $max: '$timestamp' } } },
      { $match: { count: { $gt: 30 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Resolve all referenced IDs to names in one batched read, then attach.
    const nameMap = await resolveUserNames([
      ...highVolumeAccessors.map((a: any) => a.userId),
      ...failedAccessClusters.map((c: any) => c._id?.userId),
      ...afterHoursAccess.map((a: any) => a._id),
      ...singlePatientFrequency.flatMap((s: any) => [s._id?.userId, s._id?.targetId]),
    ]);

    // For each flagged single-patient pair, is the accessor the patient's assigned
    // doctor? Read-only — labels access as in/out of a care relationship.
    const spfTargetIds = singlePatientFrequency.map((s: any) => s._id?.targetId).filter(Boolean);
    const spfPatients = spfTargetIds.length
      ? await PatientSchema.find({ _id: { $in: spfTargetIds } }).select('doctor').lean()
      : [];
    const patientDoctorMap: Record<string, string | null> = {};
    for (const p of spfPatients) {
      patientDoctorMap[String((p as any)._id)] = (p as any).doctor ? String((p as any).doctor) : null;
    }

    await auditAdminAction(req, 'admin_view_audit_anomalies', 'READ', true);

    res.json({
      period: { from: since.toISOString(), to: new Date().toISOString() },
      anomalies: {
        highVolumeAccessors: highVolumeAccessors.map((a: any) => ({
          ...a,
          userName: nameMap[String(a.userId)],
        })),
        failedAccessClusters: failedAccessClusters.map((c: any) => ({
          ...c,
          userName: nameMap[String(c._id?.userId)],
        })),
        afterHoursAccess: afterHoursAccess.map((a: any) => ({
          ...a,
          userName: nameMap[String(a._id)],
        })),
        singlePatientFrequency: singlePatientFrequency.map((s: any) => ({
          ...s,
          userName: nameMap[String(s._id?.userId)],
          targetName: nameMap[String(s._id?.targetId)],
          assignedToAccessor: patientDoctorMap[String(s._id?.targetId)] === String(s._id?.userId),
        })),
      },
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_view_audit_anomalies', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Log Reviews (PDL loggkontroll — documented review records) ============

const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || '';

function generateLogReviewHash(data: {
  reviewedBy: string;
  periodFrom: Date;
  periodTo: Date;
  outcome: string;
  createdAt: Date;
}): string {
  if (!AUDIT_HMAC_KEY) return '';
  const payload = JSON.stringify({
    reviewedBy: data.reviewedBy,
    periodFrom: data.periodFrom.toISOString(),
    periodTo: data.periodTo.toISOString(),
    outcome: data.outcome,
    createdAt: data.createdAt.toISOString(),
  });
  return crypto.createHmac('sha256', AUDIT_HMAC_KEY).update(payload).digest('hex');
}

/**
 * Record a completed systematic log review (loggkontroll)
 * POST /api/admin/audit-logs/reviews
 */
export const createLogReview = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { periodFrom, periodTo, parametersReviewed, outcome, notes, flaggedEntries, anomalySnapshot } = req.body;

    const from = periodFrom ? new Date(periodFrom) : null;
    const to = periodTo ? new Date(periodTo) : null;
    if (!from || isNaN(from.getTime()) || !to || isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Valid periodFrom and periodTo are required' });
    }
    if (from > to) {
      return res.status(400).json({ error: 'periodFrom must be before periodTo' });
    }
    if (!(LOG_REVIEW_OUTCOMES as readonly string[]).includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be one of clean, flagged, escalated' });
    }

    const params: LogReviewParameter[] = Array.isArray(parametersReviewed)
      ? parametersReviewed.filter((p: string): p is LogReviewParameter =>
          (LOG_REVIEW_PARAMETERS as readonly string[]).includes(p))
      : [];

    const admin = await AdminSchema.findById(req.admin.userId).select('name').lean();
    const reviewerName = (admin as any)?.name || req.admin.userId;

    const createdAt = new Date();
    const integrityHash = generateLogReviewHash({
      reviewedBy: req.admin.userId,
      periodFrom: from,
      periodTo: to,
      outcome,
      createdAt,
    });

    const review = await LogReviewSchema.create({
      reviewedBy: new Types.ObjectId(req.admin.userId),
      reviewerName,
      periodFrom: from,
      periodTo: to,
      parametersReviewed: params,
      outcome,
      notes: typeof notes === 'string' ? notes : undefined,
      flaggedEntries: Array.isArray(flaggedEntries)
        ? flaggedEntries.map((id: string) => new Types.ObjectId(id))
        : undefined,
      anomalySnapshot: anomalySnapshot && typeof anomalySnapshot === 'object' ? anomalySnapshot : undefined,
      status: 'open',
      createdAt,
      ...(integrityHash && { integrityHash }),
    });

    await auditAdminAction(req, 'admin_create_log_review', 'CREATE', true, (review._id as Types.ObjectId).toString(), { outcome, parameters: params });

    res.status(201).json({ review });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_create_log_review', 'CREATE', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * List recorded log reviews with pagination
 * GET /api/admin/audit-logs/reviews?page=1&limit=20&outcome=&status=
 */
export const getLogReviews = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const filter: any = {};
    if (req.query.outcome && (LOG_REVIEW_OUTCOMES as readonly string[]).includes(req.query.outcome as string)) {
      filter.outcome = req.query.outcome;
    }
    if (req.query.status === 'open' || req.query.status === 'resolved') {
      filter.status = req.query.status;
    }

    const [reviews, totalCount] = await Promise.all([
      LogReviewSchema.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LogReviewSchema.countDocuments(filter),
    ]);

    await auditAdminAction(req, 'admin_view_log_reviews', 'READ', true, undefined, { page, filters: Object.keys(filter) });

    res.json({
      reviews,
      pagination: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_view_log_reviews', 'READ', false, undefined, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get a single log review
 * GET /api/admin/audit-logs/reviews/:id
 */
export const getLogReviewById = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }

    const review = await LogReviewSchema.findById(id).lean();
    if (!review) {
      return res.status(404).json({ error: 'Log review not found' });
    }

    await auditAdminAction(req, 'admin_view_log_review', 'READ', true, id);

    res.json({ review });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_view_log_review', 'READ', false, req.params.id, undefined, error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Resolve an escalated/open log review
 * PATCH /api/admin/audit-logs/reviews/:id/resolve
 */
export const resolveLogReview = async (req: AdminAuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }

    const { resolutionNotes } = req.body;

    const updated = await LogReviewSchema.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'resolved',
          resolvedBy: new Types.ObjectId(req.admin.userId),
          resolvedAt: new Date(),
          ...(typeof resolutionNotes === 'string' ? { resolutionNotes } : {}),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'Log review not found' });
    }

    await auditAdminAction(req, 'admin_resolve_log_review', 'UPDATE', true, id);

    res.json({ review: updated });
  } catch (error: any) {
    await auditAdminAction(req, 'admin_resolve_log_review', 'UPDATE', false, req.params.id, undefined, error);
    res.status(500).json({ error: error.message });
  }
};
