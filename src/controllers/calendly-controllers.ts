import { Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import { AdminAuthenticatedRequest } from "../middleware/admin-auth-middleware";
import { createSingleUseLink, getCalendlyUserByEmail, getScheduledEvents, getScheduledEventsByInviteeEmail, getEventInvitees, getPatientMeetingByStoredUri } from "../services/calendly-service";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import AdminSchema from "../schemas/admin-schema";
import ProviderSchema from "../schemas/provider-schema";

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
        new Error("Patient not found"), patientId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    if (!patient.doctor) {
      await auditDatabaseError(req, "create_patient_booking_no_doctor", "READ",
        new Error("Patient has no assigned doctor"), patientId);
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
        new Error("Doctor has no Calendly configuration"), patientId);
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
          new Error(`Doctor not found in Calendly`), patientId);
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

    // Create pre-fill URL with patient data and UTM tracking
    const prefillParams = new URLSearchParams({
      'name': patient.name,
      'email': patient.email,
      'utm_term': `patient_${patientId}` // Required for webhook to identify patient
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
    await auditDatabaseError(req, "create_patient_booking_link", "CREATE", error, req.user?.userId);

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
    const { collection: meetings } = await getScheduledEvents(doctorUri, filters);

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
        new Error("Patient not found"), patientId);
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const hasDoctor = !!patient.doctor;

    // Get all meetings from patient's history
    const formattedMeetings: any[] = [];

    // First, add meetings from stored history
    if (patient.calendly?.meetings && patient.calendly.meetings.length > 0) {
      for (const meeting of patient.calendly.meetings) {
        // Try to get real-time details from Calendly for active meetings
        if (meeting.status === 'scheduled' && meeting.eventUri) {
          try {
            const calendlyData = await getPatientMeetingByStoredUri(
              meeting.eventUri,
              meeting.inviteeUri,
              undefined
            );

            if (calendlyData.event) {
              formattedMeetings.push({
                id: meeting.eventUri,
                patientName: calendlyData.invitee?.name || patient.name,
                startTime: calendlyData.event.start_time,
                endTime: calendlyData.event.end_time,
                status: calendlyData.event.status,
                meetingUrl: calendlyData.event.location?.join_url || null,
                eventType: calendlyData.event.name || 'Appointment',
                createdAt: calendlyData.event.created_at,
                cancelUrl: calendlyData.invitee?.cancel_url || null,
                rescheduleUrl: calendlyData.invitee?.reschedule_url || null,
                source: meeting.source
              });
              continue;
            }
          } catch (lookupErr) {
            console.error(`Calendly lookup failed for event ${meeting.eventUri}:`, lookupErr);
            // Fall through to use stored data below
          }
        }

        // For completed/canceled meetings or if Calendly lookup failed, use stored data
        formattedMeetings.push({
          id: meeting.eventUri,
          patientName: patient.name,
          startTime: meeting.scheduledTime,
          endTime: meeting.endTime || null,
          status: meeting.status === 'completed' ? 'active' : meeting.status,
          meetingUrl: meeting.meetingUrl || null,
          eventType: meeting.eventType || 'Appointment',
          createdAt: meeting.createdAt,
          cancelUrl: meeting.cancelUrl || null,
          rescheduleUrl: meeting.rescheduleUrl || null,
          calendlyHostName: meeting.calendlyHostName || null,
          source: meeting.source,
          completedAt: meeting.completedAt
        });
      }
    }

    // Sort by scheduled time (newest first)
    formattedMeetings.sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    console.log(`📅 Returning ${formattedMeetings.length} meetings from history`);

    if (hasDoctor) {
      await auditDatabaseOperation(req, "get_patient_meetings", "READ", patientId, {
        patientId,
        doctorId: (patient.doctor as any)._id,
        meetingsCount: formattedMeetings.length
      });
    }

    res.status(200).json({
      success: true,
      patient: {
        name: patient.name,
        email: patient.email
      },
      doctorName: hasDoctor ? (patient.doctor as any).name : null,
      meetings: formattedMeetings,
      count: formattedMeetings.length
    });

  } catch (error) {
    console.error('Error fetching patient meetings:', error);
    await auditDatabaseError(req, "get_patient_meetings", "READ", error, req.user?.userId);

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
    const { pageToken, count } = req.query;

    if (!doctorId) {
      res.status(401).json({ error: "Doctor authentication required" });
      return;
    }

    // Validate count parameter
    let meetingCount = 5; // default
    if (count) {
      const parsedCount = Number(count);
      if (isNaN(parsedCount) || parsedCount < 1 || parsedCount > 100) {
        res.status(400).json({
          error: "Count must be a number between 1 and 100",
          received: count
        });
        return;
      }
      meetingCount = parsedCount;
    }

    // Get doctor with Calendly configuration
    const doctor = await DoctorSchema.findById(doctorId);
    if (!doctor) {
      await auditDatabaseError(req, "get_doctor_own_meetings_find_doctor", "READ",
        new Error("Doctor not found"), doctorId);
      res.status(404).json({ error: "Doctor not found" });
      return;
    }

    // Use doctor's Calendly URI or find by email
    let doctorUri = doctor.calendlyUserUri;
    if (!doctorUri) {
      doctorUri = await getCalendlyUserByEmail(doctor.email) || undefined;

      if (!doctorUri) {
        await auditDatabaseError(req, "get_doctor_own_meetings_not_in_calendly", "READ",
          new Error("Doctor not found in Calendly"), doctorId);
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

    // Fetch scheduled events for this doctor with pagination (dynamic count)
    const { collection: meetings, pagination } = await getScheduledEvents(doctorUri, {
      status: 'active',
      sort: 'start_time:desc',
      count: meetingCount,
      pageToken: pageToken as string | undefined
    });

    // Fetch invitee data for each meeting in the batch
    const meetingsWithInvitees = await Promise.all(
      meetings.map(async (meeting: any) => {
        const invitees = await getEventInvitees(meeting.uri);
        const primaryInvitee = invitees[0] || {};

        return {
          id: meeting.uri,
          inviteeName: primaryInvitee.name || 'Unknown',
          inviteeEmail: primaryInvitee.email || '',
          startTime: meeting.start_time,
          endTime: meeting.end_time,
          status: meeting.status,
          meetingUrl: meeting.location?.join_url || null,
          eventType: meeting.name || 'Appointment',
          createdAt: meeting.created_at,
          cancelUrl: meeting.cancel_url || null,
          rescheduleUrl: meeting.reschedule_url || null,
          calendlyHostName: meeting.event_memberships?.[0]?.user_name || null,
          calendlyHostEmail: meeting.event_memberships?.[0]?.user_email || null
        };
      })
    );

    await auditDatabaseOperation(req, "get_doctor_own_meetings", "READ", doctorId, {
      doctorId,
      meetingsCount: meetingsWithInvitees.length,
      hasMorePages: !!pagination.next_page_token
    });

    res.status(200).json({
      success: true,
      doctor: {
        name: doctor.name,
        email: doctor.email
      },
      meetings: meetingsWithInvitees,
      count: meetingsWithInvitees.length,
      pagination: {
        nextPageToken: pagination.next_page_token || null,
        hasMore: !!pagination.next_page_token
      }
    });

  } catch (error) {
    console.error('Error fetching doctor meetings:', error);
    await auditDatabaseError(req, "get_doctor_own_meetings", "READ", error, req.user?.userId);

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
      // No doctor yet — return empty response so frontend can fall back to generic booking
      res.status(200).json({ success: true, eventType: null, message: "No doctor assigned yet" });
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
    await auditDatabaseError(req, "get_patient_available_event_types", "READ", error, req.user?.userId);

    res.status(500).json({
      error: "Failed to fetch available appointment types",
      message: "Please try again or contact support"
    });
  }
};

// Import for webhook handler
import crypto from "crypto";
import { Request } from "express";
import { PendingSession, PendingBooking } from "../schemas/pending-booking-schema";

// Calendly webhook types
type CalendlyWebhookEvent = {
  event: "invitee.created" | "invitee.canceled";
  created_at: string;
  payload: {
    uri: string;
    email: string;
    name: string;
    status: string;
    event: string;
    scheduled_event: {
      uri: string;
      name?: string;
      start_time: string;
      end_time: string;
      location?: {
        type?: string;
        join_url?: string;
        status?: string;
      };
    };
    tracking?: {
      utm_campaign?: string;
      utm_source?: string;
      utm_medium?: string;
      utm_content?: string;
      utm_term?: string;
    };
    cancel_url?: string;
    reschedule_url?: string;
  };
};

// Verify Calendly webhook signature
const verifyCalendlySignature = (
  payload: string,
  signature: string,
  webhookSecret: string
): boolean => {
  const [timestampPart, signaturePart] = signature.split(",").map((part) => {
    const [, value] = part.split("=");
    return value;
  });

  if (!timestampPart || !signaturePart) {
    console.error("Invalid signature format");
    return false;
  }

  // Tolerance of 5 minutes for timestamp
  const tolerance = 300; // 5 minutes in seconds
  const currentTime = Math.floor(Date.now() / 1000);
  const signatureTime = parseInt(timestampPart, 10);

  if (Math.abs(currentTime - signatureTime) > tolerance) {
    console.error("Webhook signature timestamp is too old");
    return false;
  }

  // Calculate expected signature
  const signedPayload = `${timestampPart}.${payload}`;
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signaturePart),
    Buffer.from(expectedSignature)
  );
};

// Handle Calendly webhook events
export const handleCalendlyWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const signature = req.headers["calendly-webhook-signature"] as string;
    const webhookSecret = process.env.CALENDLY_WEBHOOK_SECRET;

    // Verify webhook secret is configured
    if (!webhookSecret) {
      console.error("CALENDLY_WEBHOOK_SECRET is not configured");
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }

    // Get raw body for signature verification
    // Body comes as Buffer from express.raw() middleware
    let rawBody: string;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (typeof req.body === "string") {
      rawBody = req.body;
    } else {
      rawBody = JSON.stringify(req.body);
    }

    // Verify signature (optional in development, required in production)
    if (signature) {
      const isValid = verifyCalendlySignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        console.error("Invalid Calendly webhook signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    } else if (process.env.NODE_ENV === "production") {
      console.error("Missing Calendly webhook signature in production");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    // Parse the event from the raw body
    const event: CalendlyWebhookEvent = JSON.parse(rawBody);

    console.log(`📅 Calendly webhook received: ${event.event}`);
    console.log(`📋 Webhook payload tracking:`, JSON.stringify(event.payload.tracking, null, 2));

    switch (event.event) {
      case "invitee.created": {
        // Extract tracking identifier from UTM
        const utmTerm = event.payload.tracking?.utm_term;
        console.log(`🔑 UTM Term: ${utmTerm || 'NOT FOUND'}`);

        const scheduledTime = new Date(event.payload.scheduled_event.start_time);
        const eventUri = event.payload.scheduled_event.uri;
        const inviteeUri = event.payload.uri;
        const eventName = event.payload.scheduled_event.name || undefined;
        const meetingUrl = event.payload.scheduled_event.location?.join_url || undefined;
        const endTime = event.payload.scheduled_event.end_time ? new Date(event.payload.scheduled_event.end_time) : undefined;
        const cancelUrl = event.payload.cancel_url || undefined;
        const rescheduleUrl = event.payload.reschedule_url || undefined;
        const calendlyHostName = event.payload.name || undefined;

        // Check if this is a provider booking (utm_term: "provider_{patientId}_{providerId}")
        if (utmTerm?.startsWith("provider_")) {
          const parts = utmTerm.split("_");
          if (parts.length < 3) {
            console.error(`❌ Malformed provider UTM term: ${utmTerm}`);
            res.status(400).json({ error: "Malformed provider tracking term" });
            return;
          }
          const patientId = parts[1];
          const providerId = parts[2];
          console.log(`📱 Provider booking for patient: ${patientId}, provider: ${providerId}`);

          const [patient, provider] = await Promise.all([
            PatientSchema.findById(patientId),
            ProviderSchema.findById(providerId),
          ]);

          if (!patient) {
            console.error(`❌ Patient not found for provider webhook: ${patientId}`);
            res.status(500).json({ error: "Patient not found - retry needed" });
            return;
          }
          if (!provider) {
            console.error(`❌ Provider not found for webhook: ${providerId}`);
            res.status(500).json({ error: "Provider not found - retry needed" });
            return;
          }

          // Initialize providerMeetings array if needed
          if (!patient.providerMeetings) {
            patient.providerMeetings = [];
          }

          // Idempotency check
          const existingMeeting = patient.providerMeetings.find(
            (m: any) => m.eventUri === eventUri
          );
          if (existingMeeting) {
            console.log(`⚠️ Provider meeting already exists for eventUri: ${eventUri} - skipping duplicate`);
            res.status(200).json({ received: true, message: "Already processed", duplicate: true });
            return;
          }

          const endTime = event.payload.scheduled_event.end_time
            ? new Date(event.payload.scheduled_event.end_time)
            : undefined;

          patient.providerMeetings.push({
            providerId: provider._id,
            providerName: provider.name,
            providerType: provider.providerType,
            eventUri,
            inviteeUri,
            scheduledTime,
            endTime,
            status: "scheduled",
            eventType: "consultation",
            createdAt: new Date(),
          } as any);

          await patient.save();

          console.log(`✅ Provider booking saved for patient: ${patientId}, provider: ${providerId}`);
          res.status(200).json({ received: true, bookingCreated: true, source: "provider" });
          return;
        }

        // Check if this is a post-login booking (patientId prefixed with "patient_")
        if (utmTerm?.startsWith("patient_")) {
          const patientId = utmTerm.replace("patient_", "");
          console.log(`📱 Post-login booking for patient: ${patientId}`);

          const patient = await PatientSchema.findById(patientId);
          if (!patient) {
            console.error(`❌ Patient not found for webhook: ${patientId} - Calendly should retry`);
            res.status(500).json({ error: "Patient not found - retry needed" });
            return;
          }

          // Initialize calendly object if needed
          if (!patient.calendly) {
            patient.calendly = {};
          }
          if (!patient.calendly.meetings) {
            patient.calendly.meetings = [];
          }

          // Check for duplicate (idempotency) - prevent duplicate bookings from webhook retries
          const existingMeeting = patient.calendly.meetings.find(
            m => m.eventUri === eventUri
          );
          if (existingMeeting) {
            console.log(`⚠️ Meeting already exists for eventUri: ${eventUri} - skipping duplicate`);
            res.status(200).json({ received: true, message: "Already processed", duplicate: true });
            return;
          }

          // Create meeting record
          const meetingRecord = {
            eventUri,
            inviteeUri,
            scheduledTime,
            endTime,
            status: "scheduled" as const,
            source: "post-login" as const,
            eventType: eventName,
            meetingUrl,
            cancelUrl,
            rescheduleUrl,
            calendlyHostName: calendlyHostName,
            createdAt: new Date()
          };

          // Add to meetings history
          patient.calendly.meetings.push(meetingRecord);

          // Update current meeting fields (don't reset to "scheduled" if gate already passed)
          const gateAlreadyPassed =
            patient.calendly.meetingStatus === "completed" ||
            !!patient.calendly.completedAt ||
            patient.calendly.meetings.length >= 2;
          if (!gateAlreadyPassed) {
            patient.calendly.meetingStatus = "scheduled";
          }
          patient.calendly.scheduledMeetingTime = scheduledTime;
          patient.calendly.eventUri = eventUri;
          patient.calendly.inviteeUri = inviteeUri;

          await patient.save();

          console.log(`✅ Post-login booking saved for patient: ${patientId}`);
          res.status(200).json({ received: true, bookingCreated: true, source: "post-login" });
          return;
        }

        // Pre-login flow (existing logic)
        if (!utmTerm) {
          console.log("No token in webhook - booking may not be from tracked flow");
          res.status(200).json({ received: true, message: "No tracking token found" });
          return;
        }

        // Verify pending session exists (pre-login flow)
        const pendingSession = await PendingSession.findOne({ token: utmTerm });
        if (!pendingSession) {
          console.error(`❌ Session not found for token: ${utmTerm} - Calendly should retry`);
          res.status(500).json({ error: "Session not found - retry needed" });
          return;
        }

        // Check for duplicate pending booking (idempotency)
        const existingPendingBooking = await PendingBooking.findOne({ calendlyEventUri: eventUri });
        if (existingPendingBooking) {
          console.log(`⚠️ Pending booking already exists for eventUri: ${eventUri} - skipping duplicate`);
          res.status(200).json({ received: true, message: "Already processed", duplicate: true });
          return;
        }

        // Set expiry for pending booking (30 days)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Create pending booking
        const pendingBooking = new PendingBooking({
          token: utmTerm,
          calendlyEventUri: eventUri,
          calendlyInviteeUri: inviteeUri,
          inviteeEmail: event.payload.email,
          inviteeName: event.payload.name,
          scheduledTime,
          endTime,
          eventType: eventName,
          meetingUrl,
          cancelUrl,
          rescheduleUrl,
          calendlyHostName,
          status: "active",
          expiresAt,
        });

        await pendingBooking.save();

        console.log(`✅ Created pending booking for token: ${utmTerm}`);
        res.status(200).json({ received: true, bookingCreated: true, source: "pre-login" });
        break;
      }

      case "invitee.canceled": {
        const canceledInviteeUri = event.payload.uri;

        // First, try to find and update pending booking
        const booking = await PendingBooking.findOneAndUpdate(
          { calendlyInviteeUri: canceledInviteeUri },
          { status: "canceled" }
        );

        if (booking) {
          console.log(`❌ Marked pending booking as canceled: ${canceledInviteeUri}`);
        }

        // Also find and update any patient with this meeting
        const patient = await PatientSchema.findOne({
          $or: [
            { "calendly.inviteeUri": canceledInviteeUri },
            { "calendly.meetings.inviteeUri": canceledInviteeUri }
          ]
        });

        if (patient) {
          // Update meeting in history array
          if (patient.calendly?.meetings) {
            const meetingIndex = patient.calendly.meetings.findIndex(
              m => m.inviteeUri === canceledInviteeUri
            );
            if (meetingIndex !== -1) {
              patient.calendly.meetings[meetingIndex].status = "canceled";
            }
          }

          // If this was the current meeting, clear it
          if (patient.calendly?.inviteeUri === canceledInviteeUri) {
            patient.calendly.meetingStatus = "none";
            patient.calendly.scheduledMeetingTime = undefined;
            patient.calendly.eventUri = undefined;
            patient.calendly.inviteeUri = undefined;
          }

          await patient.save();
          console.log(`🧹 Updated meeting status for patient: ${patient._id}`);
        }

        // Also check provider meetings for cancellation
        const providerPatient = await PatientSchema.findOne({
          "providerMeetings.inviteeUri": canceledInviteeUri,
        });
        if (providerPatient && providerPatient.providerMeetings) {
          const pmIndex = providerPatient.providerMeetings.findIndex(
            (m: any) => m.inviteeUri === canceledInviteeUri
          );
          if (pmIndex !== -1) {
            (providerPatient.providerMeetings[pmIndex] as any).status = "canceled";
            await providerPatient.save();
            console.log(`🧹 Updated provider meeting status for patient: ${providerPatient._id}`);
          }
        }

        // Also handle linked user from pending booking
        if (booking?.linkedUserId && (!patient || patient._id?.toString() !== booking.linkedUserId.toString())) {
          await PatientSchema.findByIdAndUpdate(booking.linkedUserId, {
            "calendly.meetingStatus": "none",
            "calendly.scheduledMeetingTime": null,
            "calendly.eventUri": null,
            "calendly.inviteeUri": null,
          });
          console.log(`🧹 Cleared meeting data for linked patient: ${booking.linkedUserId}`);
        }

        res.status(200).json({ received: true, bookingCanceled: true });
        break;
      }

      default:
        console.log(`Unhandled Calendly webhook event: ${event.event}`);
        res.status(200).json({ received: true });
    }
  } catch (error) {
    console.error("Error processing Calendly webhook:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

// Mark meeting as complete (admin action)
export const markMeetingComplete = async (
  req: AdminAuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const adminId = req.admin?.userId;
    const { patientId } = req.params;

    if (!adminId) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    if (!patientId) {
      res.status(400).json({ error: "Patient ID is required" });
      return;
    }

    // Verify admin exists
    const admin = await AdminSchema.findById(adminId);
    if (!admin) {
      res.status(404).json({ error: "Admin not found" });
      return;
    }

    // Find patient
    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const previousStatus = patient.calendly?.meetingStatus || "none";

    // Accept completedAt and force flag from frontend
    const { completedAt, force } = req.body;
    const completedAtDate = completedAt ? new Date(completedAt) : new Date();

    // Validate meeting end time (unless force override is used)
    if (!force) {
      // Find the current meeting to check its scheduled time
      const currentMeeting = patient.calendly?.meetings?.find(
        m => m.eventUri === patient.calendly?.eventUri
      );

      if (currentMeeting?.scheduledTime) {
        // Calculate meeting end time (default 30 min duration - can be enhanced to fetch from Calendly)
        const meetingDurationMs = 30 * 60 * 1000; // 30 minutes in milliseconds
        const meetingEndTime = new Date(currentMeeting.scheduledTime).getTime() + meetingDurationMs;

        if (Date.now() < meetingEndTime) {
          console.log(`⚠️ Admin ${adminId} tried to mark meeting complete before it ended`);
          res.status(400).json({
            error: "Cannot mark meeting as complete",
            message: "Meeting has not ended yet. Use force=true to override.",
            scheduledTime: currentMeeting.scheduledTime,
            estimatedEndTime: new Date(meetingEndTime).toISOString(),
            requiresForce: true
          });
          return;
        }
      }
    }

    // Update patient meeting status using nested calendly object
    if (!patient.calendly) {
      patient.calendly = {};
    }
    patient.calendly.meetingStatus = "completed";
    patient.calendly.completedAt = completedAtDate;

    // Also update the current meeting in the meetings array
    if (patient.calendly.meetings && patient.calendly.eventUri) {
      const meetingIndex = patient.calendly.meetings.findIndex(
        m => m.eventUri === patient.calendly!.eventUri
      );
      if (meetingIndex !== -1) {
        patient.calendly.meetings[meetingIndex].status = "completed";
        patient.calendly.meetings[meetingIndex].completedAt = completedAtDate;
      }
    }

    await patient.save();

    await auditDatabaseOperation(req, "mark_meeting_complete", "UPDATE", patientId, {
      adminId,
      patientId,
      previousStatus,
    });

    console.log(`✅ Admin ${adminId} marked meeting complete for patient ${patientId}`);

    res.status(200).json({
      success: true,
      message: "Meeting marked as complete",
      meetingStatus: "completed",
      completedAt: patient.calendly.completedAt,
    });
  } catch (error) {
    console.error("Error marking meeting complete:", error);
    await auditDatabaseError(req as any, "mark_meeting_complete", "UPDATE", error, req.params?.patientId);

    res.status(500).json({
      error: "Failed to mark meeting as complete",
      message: "Please try again or contact support",
    });
  }
};

// Mark meeting as complete by patient email (admin action)
export const markMeetingCompleteByEmail = async (
  req: AdminAuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const adminId = req.admin?.userId;
    const { email } = req.body;

    if (!adminId) {
      res.status(401).json({ error: "Admin authentication required" });
      return;
    }

    if (!email) {
      res.status(400).json({ error: "Patient email is required" });
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: "Invalid email format" });
      return;
    }

    // Verify admin exists
    const admin = await AdminSchema.findById(adminId);
    if (!admin) {
      res.status(404).json({ error: "Admin not found" });
      return;
    }

    // Find patient by email
    const patient = await PatientSchema.findOne({ email: email.toLowerCase() });
    if (!patient) {
      res.status(404).json({ error: "Patient not found with this email" });
      return;
    }

    const previousStatus = patient.calendly?.meetingStatus || "none";

    // Accept completedAt and force flag from frontend
    const { completedAt, force } = req.body;
    const completedAtDate = completedAt ? new Date(completedAt) : new Date();

    // Validate meeting end time (unless force override is used)
    if (!force) {
      // Find the current meeting to check its scheduled time
      const currentMeeting = patient.calendly?.meetings?.find(
        m => m.eventUri === patient.calendly?.eventUri
      );

      if (currentMeeting?.scheduledTime) {
        // Calculate meeting end time (default 30 min duration - can be enhanced to fetch from Calendly)
        const meetingDurationMs = 30 * 60 * 1000; // 30 minutes in milliseconds
        const meetingEndTime = new Date(currentMeeting.scheduledTime).getTime() + meetingDurationMs;

        if (Date.now() < meetingEndTime) {
          console.log(`⚠️ Admin ${adminId} tried to mark meeting complete by email before it ended`);
          res.status(400).json({
            error: "Cannot mark meeting as complete",
            message: "Meeting has not ended yet. Use force=true to override.",
            scheduledTime: currentMeeting.scheduledTime,
            estimatedEndTime: new Date(meetingEndTime).toISOString(),
            requiresForce: true
          });
          return;
        }
      }
    }

    // Update patient meeting status using nested calendly object
    if (!patient.calendly) {
      patient.calendly = {};
    }
    patient.calendly.meetingStatus = "completed";
    patient.calendly.completedAt = completedAtDate;

    // Also update the current meeting in the meetings array
    if (patient.calendly.meetings && patient.calendly.eventUri) {
      const meetingIndex = patient.calendly.meetings.findIndex(
        m => m.eventUri === patient.calendly!.eventUri
      );
      if (meetingIndex !== -1) {
        patient.calendly.meetings[meetingIndex].status = "completed";
        patient.calendly.meetings[meetingIndex].completedAt = completedAtDate;
      }
    }

    await patient.save();

    await auditDatabaseOperation(req, "mark_meeting_complete_by_email", "UPDATE", patient._id?.toString(), {
      adminId,
      patientEmail: email,
      previousStatus,
    });

    console.log(`✅ Admin ${adminId} marked meeting complete for patient email: ${email}`);

    res.status(200).json({
      success: true,
      message: "Meeting marked as complete",
      meetingStatus: "completed",
      completedAt: patient.calendly.completedAt,
      patientName: patient.name,
    });
  } catch (error) {
    console.error("Error marking meeting complete by email:", error);
    await auditDatabaseError(req, "mark_meeting_complete_by_email", "UPDATE", error, (req as any).body?.email);

    res.status(500).json({
      error: "Failed to mark meeting as complete",
      message: "Please try again or contact support",
    });
  }
};