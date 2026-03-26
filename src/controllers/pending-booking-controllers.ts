import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { Types } from "mongoose";
import { PendingSession, PendingBooking } from "../schemas/pending-booking-schema";
import PatientSchema from "../schemas/patient-schema";
import { AuthenticatedRequest } from "../types/generic-types";
import { CreatePendingSessionRequest } from "../types/pending-booking-type";

// Create a new pending session (public - no auth required)
export const createPendingSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { height, weight, bmi } = req.body as CreatePendingSessionRequest;

    // Validate input
    if (!height || !weight || !bmi) {
      res.status(400).json({
        success: false,
        error: "Height, weight, and BMI are required"
      });
      return;
    }

    // Validate BMI eligibility
    if (bmi < 27) {
      res.status(400).json({
        success: false,
        error: "BMI must be 27 or higher to qualify"
      });
      return;
    }

    // Generate unique token
    const token = uuidv4();

    // Set expiry time (24 hours from now)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Create pending session
    const pendingSession = new PendingSession({
      token,
      bmiData: {
        height,
        weight,
        bmi,
      },
      expiresAt,
    });

    await pendingSession.save();

    console.log(`📋 Created pending session with token: ${token}`);

    res.status(201).json({
      success: true,
      token,
      expiresAt,
    });
  } catch (error) {
    console.error("Error creating pending session:", error);
    res.status(500).json({
      success: false,
      error: "Error creating pending session"
    });
  }
};

// Get pending session by token (public - no auth required)
export const getPendingSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    if (!token) {
      res.status(400).json({
        success: false,
        error: "Token is required"
      });
      return;
    }

    const pendingSession = await PendingSession.findOne({ token });

    if (!pendingSession) {
      res.status(404).json({
        success: false,
        error: "Session not found or expired"
      });
      return;
    }

    // Check if session has expired
    if (new Date() > pendingSession.expiresAt) {
      res.status(410).json({
        success: false,
        error: "Session has expired"
      });
      return;
    }

    res.status(200).json({
      success: true,
      session: {
        token: pendingSession.token,
        bmiData: pendingSession.bmiData,
        expiresAt: pendingSession.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error getting pending session:", error);
    res.status(500).json({
      success: false,
      error: "Error getting pending session"
    });
  }
};

// Link pending booking to authenticated user (requires auth)
export const linkBookingToUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    const userId = req.user?.userId;

    if (!token) {
      res.status(400).json({
        success: false,
        error: "Token is required"
      });
      return;
    }

    if (!userId) {
      res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
      return;
    }

    // Find pending booking by token
    const pendingBooking = await PendingBooking.findOne({
      token,
      status: "active"
    });

    if (!pendingBooking) {
      // No booking found - check if there's a session (user hasn't booked yet)
      const pendingSession = await PendingSession.findOne({ token });

      if (pendingSession) {
        // Session exists but no booking - user hasn't completed booking
        res.status(404).json({
          success: false,
          error: "No booking found. Please complete your booking first.",
          hasSession: true
        });
        return;
      }

      res.status(404).json({
        success: false,
        error: "Booking not found or already linked"
      });
      return;
    }

    // Find patient
    const patient = await PatientSchema.findById(userId);

    if (!patient) {
      res.status(404).json({
        success: false,
        error: "Patient not found"
      });
      return;
    }

    // Update patient with meeting info using nested calendly object
    if (!patient.calendly) {
      patient.calendly = {};
    }
    if (!patient.calendly.meetings) {
      patient.calendly.meetings = [];
    }

    // Add to meetings history
    patient.calendly.meetings.push({
      eventUri: pendingBooking.calendlyEventUri!,
      inviteeUri: pendingBooking.calendlyInviteeUri,
      scheduledTime: pendingBooking.scheduledTime!,
      endTime: pendingBooking.endTime || undefined,
      status: "scheduled",
      source: "pre-login",
      eventType: pendingBooking.eventType || undefined,
      meetingUrl: pendingBooking.meetingUrl || undefined,
      cancelUrl: pendingBooking.cancelUrl || undefined,
      rescheduleUrl: pendingBooking.rescheduleUrl || undefined,
      calendlyHostName: pendingBooking.calendlyHostName || undefined,
      createdAt: new Date()
    });

    // Update current meeting fields (don't reset to "scheduled" if gate already passed)
    const gateAlreadyPassed =
      patient.calendly.meetingStatus === "completed" ||
      !!patient.calendly.completedAt ||
      patient.calendly.meetings.length >= 2;
    if (!gateAlreadyPassed) {
      patient.calendly.meetingStatus = "scheduled";
    }
    patient.calendly.scheduledMeetingTime = pendingBooking.scheduledTime;
    patient.calendly.eventUri = pendingBooking.calendlyEventUri;
    patient.calendly.inviteeUri = pendingBooking.calendlyInviteeUri;

    // Also update BMI data if available from session
    const pendingSession = await PendingSession.findOne({ token });
    if (pendingSession) {
      patient.height = pendingSession.bmiData.height;
      patient.bmi = pendingSession.bmiData.bmi;

      // Add weight to history
      patient.weightHistory.push({
        weight: pendingSession.bmiData.weight,
        date: new Date(),
        notes: "Initial weight from BMI check",
      });
    }

    await patient.save();

    // Mark pending booking as linked
    pendingBooking.status = "linked";
    pendingBooking.linkedUserId = new Types.ObjectId(userId);
    pendingBooking.linkedAt = new Date();
    await pendingBooking.save();

    // Clean up pending session
    if (pendingSession) {
      await PendingSession.deleteOne({ token });
    }

    console.log(`✅ Linked booking to patient: ${userId}`);

    res.status(200).json({
      success: true,
      message: "Booking linked successfully",
      scheduledMeetingTime: pendingBooking.scheduledTime,
    });
  } catch (error) {
    console.error("Error linking booking to user:", error);
    res.status(500).json({
      success: false,
      error: "Error linking booking to user"
    });
  }
};

// Get meeting status for authenticated user (requires auth)
export const getMeetingStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: "User not authenticated"
      });
      return;
    }

    const patient = await PatientSchema.findById(userId).select("calendly");

    if (!patient) {
      res.status(404).json({
        success: false,
        error: "Patient not found"
      });
      return;
    }

    // Check if meeting gate is passed
    let meetingStatus = patient.calendly?.meetingStatus || "none";
    const scheduledMeetingTime = patient.calendly?.scheduledMeetingTime;
    const meetings = patient.calendly?.meetings || [];

    // Gate is permanently passed if:
    // 1. meetingStatus is "completed", OR
    // 2. Patient already has completed meetings (completedAt exists), OR
    // 3. Patient has 2+ meetings (they've clearly been through the process)
    let isMeetingGatePassed =
      meetingStatus === "completed" ||
      !!patient.calendly?.completedAt ||
      meetings.length >= 2;

    // Auto-complete if scheduled meeting time + 30 min has passed
    if (!isMeetingGatePassed && meetingStatus === "scheduled" && scheduledMeetingTime && patient.calendly) {
      const meetingEndTime = new Date(scheduledMeetingTime).getTime() + (30 * 60 * 1000);
      if (Date.now() > meetingEndTime) {
        patient.calendly.meetingStatus = "completed";
        patient.calendly.completedAt = new Date();
        await patient.save();
        meetingStatus = "completed";
        isMeetingGatePassed = true;
      }
    }

    // Get meeting URL for the current scheduled meeting (from linked pending booking)
    const currentMeeting = meetings.find(m =>
      scheduledMeetingTime && new Date(m.scheduledTime).getTime() === new Date(scheduledMeetingTime).getTime()
    );

    res.status(200).json({
      success: true,
      meetingStatus,
      scheduledMeetingTime,
      completedAt: patient.calendly?.completedAt,
      isMeetingGatePassed,
      meetingUrl: currentMeeting?.meetingUrl || '',
    });
  } catch (error) {
    console.error("Error getting meeting status:", error);
    res.status(500).json({
      success: false,
      error: "Error getting meeting status"
    });
  }
};
