import { Response } from "express";
import PatientSchema from "../schemas/patient-schema";
import { AuthenticatedRequest } from "../types/generic-types";

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

    // Get meeting URL for the current scheduled meeting
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
