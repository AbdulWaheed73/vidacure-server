import { Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import { createSingleUseLink, getCalendlyUserByEmail, getScheduledEvents, getScheduledEventsByInviteeEmail } from "../services/calendly-service";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";

// Patient booking endpoint - handles everything server-side
export const createPatientBookingLink = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { eventType } = req.body; // Now expects eventType: 'free' | 'standard' | 'premium'
    const patientId = req.user?.userId;

    // Validation
    if (!eventType || !['free', 'standard', 'premium'].includes(eventType)) {
      res.status(400).json({
        error: "Valid event type is required",
        // validTypes: ['free', 'standard', 'premium'],
        example: { eventType: "standard" }
      });
      return;
    }

    if (!patientId) {
      res.status(401).json({ error: "Patient authentication required" });
      return;
    }

    // Get patient with assigned doctor
    const patient = await PatientSchema.findById(patientId).populate('doctor');
    if (!patient) {
      await auditDatabaseError(req, "create_patient_booking_find_patient", "READ",
        new Error("Patient not found"));
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    if (!patient.doctor) {
      await auditDatabaseError(req, "create_patient_booking_no_doctor", "READ",
        new Error("Patient has no assigned doctor"));
      res.status(400).json({
        error: "No doctor assigned",
        message: "Please contact support to assign a doctor to your account"
      });
      return;
    }

    const doctor = patient.doctor as any;

    // Check if doctor has Calendly setup
    if (!doctor.calendlyUserUri) {
      await auditDatabaseError(req, "create_patient_booking_doctor_no_calendly", "READ",
        new Error("Doctor has no Calendly configuration"));
      res.status(500).json({
        error: "Doctor not available for booking",
        message: "Your assigned doctor is not set up for online booking. Please contact support."
      });
      return;
    }

    // Determine patient's allowed event type based on subscription
    const getAllowedEventType = (patient: any) => {
      // No subscription or inactive subscription = free
      if (!patient.subscription || patient.subscription.status !== 'active') {
        return 'free';
      }

      // Active subscription based on plan type
      if (patient.subscription.planType === 'medical') {
        return 'premium';
      } else if (patient.subscription.planType === 'lifestyle') {
        return 'standard';
      }

      // Fallback to free
      return 'free';
    };

    const allowedEventType = getAllowedEventType(patient);

    // Validate that patient is requesting an event type they have access to
    if (eventType !== allowedEventType) {
      const subscriptionInfo = patient.subscription?.planType
        ? `${patient.subscription.planType} (${patient.subscription.status})`
        : 'none';

      res.status(403).json({
        error: "Subscription required",
        message: `${eventType} appointments require a higher subscription plan`,
        currentSubscription: subscriptionInfo,
        allowedEventType,
        upgradeRequired: eventType !== 'free'
      });
      return;
    }

    // Check if the requested event type exists for this doctor
    const eventTypeName = doctor.eventTypes?.[eventType];
    if (!eventTypeName) {
      res.status(400).json({
        error: "Event type not available",
        message: `${eventType} appointments are not available with your doctor`
      });
      return;
    }

    // Use doctor's Calendly URI or find by email
    let doctorUri = doctor.calendlyUserUri;
    if (!doctorUri) {
      doctorUri = await getCalendlyUserByEmail(doctor.email) || undefined;

      if (!doctorUri) {
        await auditDatabaseError(req, "create_patient_booking_doctor_not_in_calendly", "READ",
          new Error(`Doctor ${doctor.email} not found in Calendly`));
        res.status(500).json({
          error: "Doctor not available for booking",
          message: "Your assigned doctor is not set up for online booking. Please contact support."
        });
        return;
      }

      // Save the found URI for future use
      await DoctorSchema.findByIdAndUpdate(doctor._id, {
        calendlyUserUri: doctorUri
      });
    }

    // Use the event type name directly as the Calendly event name
    const calendlyEventName = eventTypeName;

    // Generate single-use scheduling link
    const schedulingLink = await createSingleUseLink(calendlyEventName, doctorUri);

    // Create pre-fill URL with patient data
    const prefillParams = new URLSearchParams({
      'name': patient.name,
      'email': patient.email
    });

    const schedulingLinkWithPrefill = `${schedulingLink}?${prefillParams}`;

    await auditDatabaseOperation(req, "create_patient_booking_link", "CREATE", patientId, {
      eventType,
      calendlyEventName,
      patientId,
      doctorId: doctor._id,
      linkGenerated: true
    });

    res.status(200).json({
      success: true,
      eventType,
      eventName: eventTypeName,
      schedulingLink: schedulingLinkWithPrefill,
      singleUse: true,
      expiresAfter: "1 booking",
      patientName: patient.name,
      doctorName: doctor.name,
      message: "Booking link generated successfully"
    });

  } catch (error) {
    console.error('Error creating patient booking link:', error);
    await auditDatabaseError(req, "create_patient_booking_link", "CREATE", error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('Event type') && errorMessage.includes('not found')) {
      res.status(404).json({
        error: "Event type not found",
        details: errorMessage,
        suggestion: "The requested appointment type is not available in Calendly"
      });
      return;
    }

    if (errorMessage.includes('CALENDLY_ACCESS_TOKEN')) {
      res.status(500).json({
        error: "Booking system configuration error",
        message: "Please contact support"
      });
      return;
    }

    res.status(500).json({
      error: "Failed to generate booking link",
      message: "Please try again or contact support"
    });
  }
};

export const generateSingleUseLink = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { eventName, doctorEmail } = req.body;

    // Validation
    if (!eventName || typeof eventName !== 'string' || eventName.trim().length === 0) {
      res.status(400).json({
        error: "Event name is required and must be a non-empty string",
        example: { eventName: "Doctor Consultation" }
      });
      return;
    }

    if (doctorEmail && (typeof doctorEmail !== 'string' || !doctorEmail.includes('@'))) {
      res.status(400).json({
        error: "Doctor email must be a valid email address",
        example: { doctorEmail: "doctor@example.com" }
      });
      return;
    }

    let userUri;

    // If doctorEmail is provided, get their user URI
    if (doctorEmail) {
      userUri = await getCalendlyUserByEmail(doctorEmail.trim());
      if (!userUri) {
        await auditDatabaseError(req, "generate_single_use_link_find_doctor", "READ",
          new Error(`Doctor with email ${doctorEmail} not found`));
        res.status(404).json({
          error: `Doctor with email ${doctorEmail} not found in Calendly organization`,
          suggestion: "Ensure the doctor is part of your Calendly organization"
        });
        return;
      }
    }

    // Generate single-use scheduling link
    const schedulingLink = await createSingleUseLink(eventName.trim(), userUri);

    await auditDatabaseOperation(req, "generate_single_use_link", "CREATE", undefined, {
      eventName: eventName.trim(),
      doctorEmail: doctorEmail || 'default',
      linkGenerated: true
    });

    res.status(200).json({
      success: true,
      eventName: eventName.trim(),
      doctorEmail: doctorEmail || 'default',
      schedulingLink,
      singleUse: true,
      expiresAfter: "1 booking",
      message: "Single-use scheduling link generated successfully"
    });

  } catch (error) {
    console.error('Error generating single-use link:', error);
    await auditDatabaseError(req, "generate_single_use_link", "CREATE", error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Handle specific Calendly API errors
    if (errorMessage.includes('Event type') && errorMessage.includes('not found')) {
      res.status(404).json({
        error: "Event type not found",
        details: errorMessage,
        suggestion: "Check that the event name exists in your Calendly account"
      });
      return;
    }

    if (errorMessage.includes('CALENDLY_ACCESS_TOKEN')) {
      res.status(500).json({
        error: "Calendly configuration error",
        details: "Missing or invalid Calendly access token"
      });
      return;
    }

    res.status(500).json({
      error: "Failed to generate scheduling link",
      details: errorMessage
    });
  }
};

export const getDoctorMeetings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.params;
    const { status, sort, count, startDate, endDate } = req.query;

    // Validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({
        error: "Valid doctor email is required in URL parameter",
        example: "/api/calendly/doctor-meetings/doctor@example.com"
      });
      return;
    }

    // Validate optional query parameters
    if (status && !['active', 'canceled'].includes(status as string)) {
      res.status(400).json({
        error: "Status must be either 'active' or 'canceled'",
        received: status
      });
      return;
    }

    if (sort && !['start_time:asc', 'start_time:desc'].includes(sort as string)) {
      res.status(400).json({
        error: "Sort must be either 'start_time:asc' or 'start_time:desc'",
        received: sort
      });
      return;
    }

    if (count && (isNaN(Number(count)) || Number(count) < 1 || Number(count) > 100)) {
      res.status(400).json({
        error: "Count must be a number between 1 and 100",
        received: count
      });
      return;
    }

    // Validate date formats
    if (startDate && isNaN(Date.parse(startDate as string))) {
      res.status(400).json({
        error: "Start date must be a valid ISO date string",
        example: "2024-01-01T00:00:00Z"
      });
      return;
    }

    if (endDate && isNaN(Date.parse(endDate as string))) {
      res.status(400).json({
        error: "End date must be a valid ISO date string",
        example: "2024-12-31T23:59:59Z"
      });
      return;
    }

    // Get doctor's user URI
    const doctorUri = await getCalendlyUserByEmail(email) || undefined;
    if (!doctorUri) {
      await auditDatabaseError(req, "get_doctor_meetings_find_doctor", "READ",
        new Error(`Doctor with email ${email} not found`));
      res.status(404).json({
        error: `Doctor with email ${email} not found in Calendly organization`,
        suggestion: "Ensure the doctor is part of your Calendly organization"
      });
      return;
    }

    // Build filters
    const filters: any = {};
    if (status) filters.status = status;
    if (sort) filters.sort = sort;
    if (count) filters.count = Math.min(Number(count), 100);
    if (startDate) filters.minStartTime = new Date(startDate as string).toISOString();
    if (endDate) filters.maxStartTime = new Date(endDate as string).toISOString();

    // Fetch scheduled events
    const meetings = await getScheduledEvents(doctorUri, filters);

    // Transform data for frontend
    const formattedMeetings = meetings.map((meeting: any) => ({
      id: meeting.uri,
      patientName: meeting.name || 'Unknown',
      patientEmail: meeting.email || '',
      startTime: meeting.start_time,
      endTime: meeting.end_time,
      status: meeting.status,
      meetingUrl: meeting.location?.join_url || null,
      eventType: meeting.event_type?.name || 'Unknown Event',
      createdAt: meeting.created_at,
      cancelUrl: meeting.cancel_url || null,
      rescheduleUrl: meeting.reschedule_url || null
    }));

    await auditDatabaseOperation(req, "get_doctor_meetings", "READ", undefined, {
      doctorEmail: email,
      meetingsCount: formattedMeetings.length,
      filters
    });

    res.status(200).json({
      success: true,
      doctor: email,
      meetings: formattedMeetings,
      count: formattedMeetings.length,
      filters: filters,
      pagination: {
        hasMore: meetings.length === (filters.count || 20)
      }
    });

  } catch (error) {
    console.error('Error fetching doctor meetings:', error);
    await auditDatabaseError(req, "get_doctor_meetings", "READ", error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('CALENDLY_ACCESS_TOKEN')) {
      res.status(500).json({
        error: "Calendly configuration error",
        details: "Missing or invalid Calendly access token"
      });
      return;
    }

    res.status(500).json({
      error: "Failed to fetch doctor meetings",
      details: errorMessage
    });
  }
};

// Get patient's scheduled meetings with their assigned doctor
export const getPatientMeetings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const patientId = req.user?.userId;

    if (!patientId) {
      res.status(401).json({ error: "Patient authentication required" });
      return;
    }

    // Get patient with assigned doctor
    const patient = await PatientSchema.findById(patientId).populate('doctor');
    if (!patient) {
      await auditDatabaseError(req, "get_patient_meetings_find_patient", "READ",
        new Error("Patient not found"));
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    if (!patient.doctor) {
      res.status(400).json({
        error: "No doctor assigned",
        message: "Please contact support to assign a doctor to your account"
      });
      return;
    }

    // Fetch scheduled events directly by patient email using organization API
    const patientMeetings = await getScheduledEventsByInviteeEmail(patient.email);

    // Transform data for frontend
    const formattedMeetings = patientMeetings.map((meeting: any) => ({
      id: meeting.uri,
      patientName: meeting.name || patient.name,
      startTime: meeting.start_time,
      endTime: meeting.end_time,
      status: meeting.status,
      meetingUrl: meeting.location?.join_url || null,
      eventType: meeting.event_type?.name || 'Appointment',
      createdAt: meeting.created_at,
      cancelUrl: meeting.cancel_url || null,
      rescheduleUrl: meeting.reschedule_url || null
    }));

    await auditDatabaseOperation(req, "get_patient_meetings", "READ", patientId, {
      patientId,
      doctorId: patient.doctor._id,
      meetingsCount: formattedMeetings.length,
      method: "organization_invitee_email"
    });

    res.status(200).json({
      success: true,
      patient: {
        name: patient.name,
        email: patient.email
      },
      doctorName: (patient.doctor as any).name,
      meetings: formattedMeetings,
      count: formattedMeetings.length
    });

  } catch (error) {
    console.error('Error fetching patient meetings:', error);
    await auditDatabaseError(req, "get_patient_meetings", "READ", error);

    res.status(500).json({
      error: "Failed to fetch your meetings",
      message: "Please try again or contact support"
    });
  }
};

// Get doctor's own scheduled meetings
export const getDoctorOwnMeetings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const doctorId = req.user?.userId;

    if (!doctorId) {
      res.status(401).json({ error: "Doctor authentication required" });
      return;
    }

    // Get doctor with Calendly configuration
    const doctor = await DoctorSchema.findById(doctorId);
    if (!doctor) {
      await auditDatabaseError(req, "get_doctor_own_meetings_find_doctor", "READ",
        new Error("Doctor not found"));
      res.status(404).json({ error: "Doctor not found" });
      return;
    }

    // Use doctor's Calendly URI or find by email
    let doctorUri = doctor.calendlyUserUri;
    if (!doctorUri) {
      doctorUri = await getCalendlyUserByEmail(doctor.email) || undefined;

      if (!doctorUri) {
        await auditDatabaseError(req, "get_doctor_own_meetings_not_in_calendly", "READ",
          new Error(`Doctor ${doctor.email} not found in Calendly`));
        res.status(500).json({
          error: "Calendly not configured",
          message: "Your Calendly account is not set up. Please contact support."
        });
        return;
      }

      // Save the found URI for future use
      await DoctorSchema.findByIdAndUpdate(doctorId, {
        calendlyUserUri: doctorUri
      });
    }

    // Fetch scheduled events for this doctor
    const meetings = await getScheduledEvents(doctorUri, {
      status: 'active',
      sort: 'start_time:asc',
      count: 100
    });

    // Transform data for frontend
    const formattedMeetings = meetings.map((meeting: any) => ({
      id: meeting.uri,
      patientName: meeting.name,
      patientEmail: meeting.email,
      startTime: meeting.start_time,
      endTime: meeting.end_time,
      status: meeting.status,
      meetingUrl: meeting.location?.join_url,
      eventType: meeting.event_type?.name,
      createdAt: meeting.created_at,
      cancelUrl: meeting.cancel_url,
      rescheduleUrl: meeting.reschedule_url,
      calendlyUserName: meeting.event_memberships?.[0]?.user_name || null,
      calendlyUserEmail: meeting.event_memberships?.[0]?.user_email || null
    }));
    console.log("meetings !!!: ", meetings[0])

    await auditDatabaseOperation(req, "get_doctor_own_meetings", "READ", doctorId, {
      doctorId,
      meetingsCount: formattedMeetings.length
    });

    res.status(200).json({
      success: true,
      doctor: {
        name: doctor.name,
        email: doctor.email
      },
      meetings: formattedMeetings,
      count: formattedMeetings.length
    });

  } catch (error) {
    console.error('Error fetching doctor meetings:', error);
    await auditDatabaseError(req, "get_doctor_own_meetings", "READ", error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: "Failed to fetch your meetings",
      details: errorMessage
    });
  }
};

// Get available event types for patient's assigned doctor
export const getPatientAvailableEventTypes = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const patientId = req.user?.userId;

    if (!patientId) {
      res.status(401).json({ error: "Patient authentication required" });
      return;
    }

    // Get patient with assigned doctor
    const patient = await PatientSchema.findById(patientId).populate('doctor');
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    if (!patient.doctor) {
      res.status(400).json({
        error: "No doctor assigned",
        message: "Please contact support to assign a doctor to your account"
      });
      return;
    }

    const doctor = patient.doctor as any;

    // Determine patient's allowed event type based on subscription
    const getAllowedEventType = (patient: any): 'free' | 'standard' | 'premium' => {
      // No subscription or inactive subscription = free
      if (!patient.subscription || patient.subscription.status !== 'active') {
        return 'free';
      }

      // Active subscription based on plan type
      if (patient.subscription.planType === 'medical') {
        return 'premium';
      } else if (patient.subscription.planType === 'lifestyle') {
        return 'standard';
      }

      // Fallback to free
      return 'free';
    };

    const allowedEventType = getAllowedEventType(patient);
    const eventTypeName = doctor.eventTypes?.[allowedEventType];

    // Check if doctor has the required event type configured
    if (!eventTypeName) {
      res.status(500).json({
        error: "Doctor configuration incomplete",
        message: `Your assigned doctor hasn't configured ${allowedEventType} appointments. Please contact support.`
      });
      return;
    }

    // Return single event type based on subscription
    const availableEventType = {
      type: allowedEventType,
      name: eventTypeName
    };

    await auditDatabaseOperation(req, "get_patient_available_event_types", "READ", patientId, {
      patientId,
      doctorId: doctor._id,
      allowedEventType,
      subscriptionPlan: patient.subscription?.planType || 'none',
      subscriptionStatus: patient.subscription?.status || 'none'
    });

    res.status(200).json({
      success: true,
      patient: {
        name: patient.name,
        email: patient.email
      },
      doctor: {
        name: doctor.name,
        email: doctor.email
      },
      eventType: availableEventType,
      subscription: {
        planType: patient.subscription?.planType || null,
        status: patient.subscription?.status || null
      }
    });

  } catch (error) {
    console.error('Error fetching available event types:', error);
    await auditDatabaseError(req, "get_patient_available_event_types", "READ", error);

    res.status(500).json({
      error: "Failed to fetch available appointment types",
      message: "Please try again or contact support"
    });
  }
};