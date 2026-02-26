import express from "express";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import ProviderSchema from "../schemas/provider-schema";
import { supabaseChatApi } from "../services/supabase-chat-api";
import stripeService from "../services/stripe-service";
import { hashSSN, isValidSwedishSSN } from "../services/auth-service";
import { getCalendlyUserByEmail, lookupCalendlyMemberByEmail } from "../services/calendly-service";

/**
 * Get dashboard statistics
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req: express.Request, res: express.Response) => {
  try {
    const [totalPatients, totalDoctors, unassignedPatients, activeSubscriptions, totalProviders] = await Promise.all([
      PatientSchema.countDocuments({}),
      DoctorSchema.countDocuments({}),
      PatientSchema.countDocuments({ doctor: { $exists: false } }),
      PatientSchema.countDocuments({
        'subscription.status': 'active'
      }),
      ProviderSchema.countDocuments({ isActive: true })
    ]);

    res.json({
      totalPatients,
      totalDoctors,
      unassignedPatients,
      activeSubscriptions,
      totalProviders
    });
  } catch (error: any) {
    console.error('Error getting dashboard stats:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all patients with doctor info
 * GET /api/admin/patients?page=1&limit=20&includeStripeData=true
 */
export const getAllPatients = async (req: express.Request, res: express.Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const includeStripeData = req.query.includeStripeData === 'true';

    const [patients, totalCount] = await Promise.all([
      PatientSchema.find({})
        .populate('doctor', 'name email _id')
        .populate('providers', 'name providerType _id')
        .select('name email doctor providers subscription lastLogin createdAt calendly')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      PatientSchema.countDocuments({})
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
    console.error('Error getting all patients:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all doctors with patient details
 * GET /api/admin/doctors
 */
export const getAllDoctors = async (req: express.Request, res: express.Response) => {
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

    res.json({
      doctors: doctorsWithStats
    });
  } catch (error: any) {
    console.error('Error getting all doctors:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Reassign patient to a new doctor
 * POST /api/admin/reassign-doctor
 * Body: { patientId: string, newDoctorId: string }
 */
export const reassignDoctor = async (req: express.Request, res: express.Response) => {
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

    // Use Supabase chat API for reassignment (handles participant updates)
    await supabaseChatApi.reassignDoctor(patientId, newDoctorId, oldDoctorId);

    // Fetch updated patient and doctor info
    const [updatedPatient, updatedNewDoctor, updatedOldDoctor] = await Promise.all([
      PatientSchema.findById(patientId).populate('doctor', 'name email'),
      DoctorSchema.findById(newDoctorId).select('name email patients assignedChannels'),
      oldDoctorId ? DoctorSchema.findById(oldDoctorId).select('name email patients assignedChannels') : null
    ]);

    res.json({
      message: 'Doctor reassigned successfully',
      patient: updatedPatient,
      newDoctor: updatedNewDoctor,
      oldDoctor: updatedOldDoctor
    });

  } catch (error: any) {
    console.error('Error reassigning doctor:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get unassigned patients
 * GET /api/admin/unassigned-patients
 */
export const getUnassignedPatients = async (req: express.Request, res: express.Response) => {
  try {
    const unassignedPatients = await PatientSchema.find({
      doctor: { $exists: false }
    })
      .select('name email subscription.status subscription.planType lastLogin createdAt')
      .sort({ createdAt: -1 });

    res.json({
      patients: unassignedPatients,
      count: unassignedPatients.length
    });
  } catch (error: any) {
    console.error('Error getting unassigned patients:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get detailed subscription information for a specific patient
 * GET /api/admin/patients/:patientId/subscription-details
 */
export const getPatientSubscriptionDetails = async (req: express.Request, res: express.Response) => {
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
      const [stripeSubscription, paymentMethod, upcomingInvoice, paymentMethods] = await Promise.all([
        stripeService.getDetailedSubscriptionInfo(patientObj.subscription.stripeSubscriptionId),
        patientObj.subscription.stripeCustomerId
          ? stripeService.getCustomerDefaultPaymentMethod(patientObj.subscription.stripeCustomerId)
          : null,
        patientObj.subscription.stripeCustomerId
          ? stripeService.getUpcomingInvoice(patientObj.subscription.stripeCustomerId)
          : null,
        patientObj.subscription.stripeCustomerId
          ? stripeService.getCustomerPaymentMethods(patientObj.subscription.stripeCustomerId)
          : []
      ]);

      res.json({
        patient: patientObj,
        stripeData: {
          subscription: stripeSubscription,
          defaultPaymentMethod: paymentMethod,
          upcomingInvoice: upcomingInvoice,
          allPaymentMethods: paymentMethods
        }
      });
    } catch (error: any) {
      console.error(`Error fetching Stripe data for patient ${patientId}:`, error);
      res.status(500).json({
        error: 'Failed to fetch Stripe subscription details',
        details: error.message
      });
    }
  } catch (error: any) {
    console.error('Error getting patient subscription details:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Check if SSN exists in Doctor or Patient collections
 * POST /api/admin/check-ssn
 * Body: { ssn: string }
 */
export const checkSSN = async (req: express.Request, res: express.Response) => {
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

    // SSN is available
    res.json({
      exists: false
    });

  } catch (error: any) {
    console.error('Error checking SSN:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Convert patient to doctor
 * POST /api/admin/convert-patient-to-doctor
 * Body: { patientId: string, email: string }
 */
export const convertPatientToDoctor = async (req: express.Request, res: express.Response) => {
  try {
    const { patientId, email } = req.body;

    // Validate required fields
    if (!patientId || !email) {
      return res.status(400).json({ error: 'Patient ID and email are required' });
    }

    // Find patient
    const patient = await PatientSchema.findById(patientId);
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

    res.status(201).json({
      message: 'Patient successfully converted to doctor. Name will be updated on first BankID login.',
      doctor: {
        _id: savedDoctor._id,
        email: savedDoctor.email,
        createdAt: savedDoctor.createdAt
      }
    });

  } catch (error: any) {
    console.error('Error converting patient to doctor:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Add a new doctor
 * POST /api/admin/add-doctor
 * Body: { ssn: string, email: string }
 */
export const addDoctor = async (req: express.Request, res: express.Response) => {
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
    console.error('Error adding doctor:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Provider Management ============

/**
 * Add a new provider
 * POST /api/admin/providers
 * Body: { name, email, providerType, specialty?, bio?, eventTypes?, adminNotes? }
 */
export const addProvider = async (req: express.Request, res: express.Response) => {
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

    res.status(201).json({
      message: `Provider created successfully.${calendlyLinked ? ' Calendly account linked.' : ' No Calendly account found for this email.'}`,
      provider: savedProvider,
    });
  } catch (error: any) {
    console.error('Error adding provider:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all providers (including inactive)
 * GET /api/admin/providers
 */
export const getAllProviders = async (req: express.Request, res: express.Response) => {
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

    res.json({ providers: providersWithStats });
  } catch (error: any) {
    console.error('Error getting all providers:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update a provider
 * PUT /api/admin/providers/:providerId
 */
export const updateProvider = async (req: express.Request, res: express.Response) => {
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

    res.json({ provider });
  } catch (error: any) {
    console.error('Error updating provider:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Deactivate a provider (soft delete)
 * DELETE /api/admin/providers/:providerId
 */
export const deactivateProvider = async (req: express.Request, res: express.Response) => {
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

    res.json({ message: 'Provider deactivated successfully', provider });
  } catch (error: any) {
    console.error('Error deactivating provider:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Assign provider to patient
 * POST /api/admin/assign-provider
 * Body: { patientId, providerId }
 */
export const assignProviderToPatient = async (req: express.Request, res: express.Response) => {
  try {
    const { patientId, providerId } = req.body;

    if (!patientId || !providerId) {
      return res.status(400).json({ error: 'patientId and providerId are required' });
    }

    const [patient, provider] = await Promise.all([
      PatientSchema.findById(patientId),
      ProviderSchema.findById(providerId),
    ]);

    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    if (!provider.isActive) {
      return res.status(400).json({ error: 'Cannot assign an inactive provider' });
    }

    // Check if already assigned
    const alreadyAssigned = (patient.providers || []).some(
      (p: any) => p.toString() === providerId
    );
    if (alreadyAssigned) {
      return res.status(400).json({ error: 'Provider is already assigned to this patient' });
    }

    await PatientSchema.findByIdAndUpdate(patientId, {
      $push: { providers: providerId },
    });

    res.json({
      message: 'Provider assigned to patient successfully',
      patientId,
      providerId,
      providerName: provider.name,
    });
  } catch (error: any) {
    console.error('Error assigning provider:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Unassign provider from patient
 * POST /api/admin/unassign-provider
 * Body: { patientId, providerId }
 */
export const unassignProviderFromPatient = async (req: express.Request, res: express.Response) => {
  try {
    const { patientId, providerId } = req.body;

    if (!patientId || !providerId) {
      return res.status(400).json({ error: 'patientId and providerId are required' });
    }

    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    await PatientSchema.findByIdAndUpdate(patientId, {
      $pull: { providers: providerId },
    });

    res.json({
      message: 'Provider unassigned from patient successfully',
      patientId,
      providerId,
    });
  } catch (error: any) {
    console.error('Error unassigning provider:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============ Provider Tier Overrides ============

/**
 * Set a provider tier override for a patient
 * POST /api/admin/provider-tier-override
 * Body: { patientId, providerId, tier: "free" | "premium" }
 */
export const setProviderTierOverride = async (req: express.Request, res: express.Response) => {
  try {
    const { patientId, providerId, tier } = req.body;

    if (!patientId || !providerId || !tier) {
      return res.status(400).json({ error: 'patientId, providerId, and tier are required' });
    }

    if (!['free', 'premium'].includes(tier)) {
      return res.status(400).json({ error: 'tier must be "free" or "premium"' });
    }

    const [patient, provider] = await Promise.all([
      PatientSchema.findById(patientId),
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

    res.json({
      message: `Tier override set to "${tier}" for provider "${provider.name}" on patient "${patient.name}"`,
      patientId,
      providerId,
      tier,
    });
  } catch (error: any) {
    console.error('Error setting provider tier override:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Remove a provider tier override for a patient (revert to default)
 * POST /api/admin/remove-provider-tier-override
 * Body: { patientId, providerId }
 */
export const removeProviderTierOverride = async (req: express.Request, res: express.Response) => {
  try {
    const { patientId, providerId } = req.body;

    if (!patientId || !providerId) {
      return res.status(400).json({ error: 'patientId and providerId are required' });
    }

    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    await PatientSchema.findByIdAndUpdate(patientId, {
      $pull: { providerTierOverrides: { providerId } },
    });

    res.json({
      message: 'Tier override removed, reverted to default logic',
      patientId,
      providerId,
    });
  } catch (error: any) {
    console.error('Error removing provider tier override:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all active providers with resolved tiers for a specific patient
 * GET /api/admin/patients/:patientId/provider-tiers
 */
export const getPatientProviderTiers = async (req: express.Request, res: express.Response) => {
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

    res.json({
      patientId,
      patientName: patient.name,
      patientPlanType: patientPlanType || null,
      providers: providersWithTiers,
    });
  } catch (error: any) {
    console.error('Error getting patient provider tiers:', error);
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
export const calendlyLookup = async (req: express.Request, res: express.Response) => {
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
    console.error('Error in Calendly lookup:', error);
    res.status(500).json({ error: error.message });
  }
};
