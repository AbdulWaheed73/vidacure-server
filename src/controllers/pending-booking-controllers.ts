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

    const meetingStatus = patient.calendly?.meetingStatus || "none";
    const scheduledMeetingTime = patient.calendly?.scheduledMeetingTime;
    const meetings = patient.calendly?.meetings || [];

    const currentMeeting = meetings.find(m =>
      scheduledMeetingTime && new Date(m.scheduledTime).getTime() === new Date(scheduledMeetingTime).getTime()
    );

    res.status(200).json({
      success: true,
      meetingStatus,
      scheduledMeetingTime,
      completedAt: patient.calendly?.completedAt,
      isMeetingGatePassed: true,
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
