import express from "express";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import { streamChatApi } from "../services/stream-chat-api";
import stripeService from "../services/stripe-service";
import { hashSSN, isValidSwedishSSN } from "../services/auth-service";

/**
 * Get dashboard statistics
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req: express.Request, res: express.Response) => {
  try {
    const [totalPatients, totalDoctors, unassignedPatients, activeSubscriptions] = await Promise.all([
      PatientSchema.countDocuments({}),
      DoctorSchema.countDocuments({}),
      PatientSchema.countDocuments({ doctor: { $exists: false } }),
      PatientSchema.countDocuments({
        'subscription.status': 'active'
      })
    ]);

    res.json({
      totalPatients,
      totalDoctors,
      unassignedPatients,
      activeSubscriptions
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
        .select('name email doctor subscription lastLogin createdAt meetingStatus scheduledMeetingTime meetingCompletedAt')
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

    // Use existing reassignDoctor function from stream-chat-api
    await streamChatApi.reassignDoctor(patientId, newDoctorId, oldDoctorId);

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
    const { ssn, email } = req.body;

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
    });

    const savedDoctor = await newDoctor.save();

    res.status(201).json({
      message: 'Doctor created successfully. Name will be populated from BankID on first login.',
      doctor: {
        _id: savedDoctor._id,
        email: savedDoctor.email,
        createdAt: savedDoctor.createdAt
      }
    });

  } catch (error: any) {
    console.error('Error adding doctor:', error);
    res.status(500).json({ error: error.message });
  }
};
