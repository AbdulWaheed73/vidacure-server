import { Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import DoctorSchema from "../schemas/doctor-schema";
import PatientSchema from "../schemas/patient-schema";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";

// Get doctor dashboard data
export async function getDoctorDashboard(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    
    // Dummy dashboard data
    const dashboardData = {
      doctor: {
        id: doctorId,
        name: req.user?.name || "Dr. Smith",
        specialization: "Internal Medicine",
        licenseNumber: "MD-12345"
      },
      stats: {
        totalPatients: 45,
        todayAppointments: 8,
        pendingPrescriptions: 12,
        unreadMessages: 5
      },
      recentActivity: [
        { type: "appointment", patient: "John Doe", time: "09:00 AM", status: "completed" },
        { type: "prescription", patient: "Jane Smith", medication: "Metformin", status: "pending" },
        { type: "message", patient: "Bob Johnson", subject: "Follow-up question", status: "unread" }
      ]
    };

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    console.error("Error fetching doctor dashboard:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Get doctor appointments
export async function getDoctorAppointments(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    
    // Dummy appointments data
    const appointments = [
      {
        id: "apt-001",
        patient: {
          id: "pat-001",
          name: "John Doe",
          age: 35,
          phone: "+46 70 123 4567"
        },
        date: new Date().toISOString().split('T')[0],
        time: "09:00",
        duration: 30,
        type: "consultation",
        status: "scheduled",
        notes: "Regular check-up"
      },
      {
        id: "apt-002",
        patient: {
          id: "pat-002",
          name: "Jane Smith",
          age: 42,
          phone: "+46 70 234 5678"
        },
        date: new Date().toISOString().split('T')[0],
        time: "10:30",
        duration: 45,
        type: "follow-up",
        status: "scheduled",
        notes: "Follow-up on diabetes management"
      },
      {
        id: "apt-003",
        patient: {
          id: "pat-003",
          name: "Bob Johnson",
          age: 28,
          phone: "+46 70 345 6789"
        },
        date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
        time: "14:00",
        duration: 30,
        type: "consultation",
        status: "scheduled",
        notes: "Initial consultation"
      }
    ];

    res.json({
      success: true,
      data: {
        appointments,
        totalCount: appointments.length,
        todayCount: appointments.filter(apt => apt.date === new Date().toISOString().split('T')[0]).length
      }
    });
  } catch (error) {
    console.error("Error fetching doctor appointments:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Get doctor prescriptions
export async function getDoctorPrescriptions(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    // Find the doctor and populate patients with only name and prescriptionRequests
    const doctor = await DoctorSchema.findById(doctorId).populate({
      path: 'patients',
      select: 'name prescriptionRequests'
    });

    if (!doctor) {
      await auditDatabaseError(req, "get_doctor_prescriptions", "READ", new Error("Doctor not found"), doctorId);
      res.status(404).json({ error: "Doctor not found" });
      return;
    }

    await auditDatabaseOperation(req, "get_doctor_prescriptions", "READ", doctorId, {
      patientsCount: doctor.patients?.length || 0
    });

    // Collect all prescription requests from assigned patients
    const allPrescriptionRequests: any[] = [];

    if (doctor.patients && doctor.patients.length > 0) {
      for (const patient of doctor.patients) {
        if ((patient as any).prescriptionRequests && (patient as any).prescriptionRequests.length > 0) {
          const patientRequests = (patient as any).prescriptionRequests.map((request: any) => ({
            ...request.toObject(),
            patient: {
              id: (patient as any)._id,
              name: (patient as any).name
            }
          }));
          allPrescriptionRequests.push(...patientRequests);
        }
      }
    }

    // Sort by creation date (newest first)
    allPrescriptionRequests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({
      success: true,
      data: {
        prescriptionRequests: allPrescriptionRequests,
        totalCount: allPrescriptionRequests.length,
        pendingCount: allPrescriptionRequests.filter(req => req.status === 'pending').length,
        approvedCount: allPrescriptionRequests.filter(req => req.status === 'approved').length,
        deniedCount: allPrescriptionRequests.filter(req => req.status === 'denied').length,
        underReviewCount: allPrescriptionRequests.filter(req => req.status === 'under_review').length
      }
    });
  } catch (error) {
    console.error("Error fetching doctor prescriptions:", error);
    await auditDatabaseError(req, "get_doctor_prescriptions", "READ", error, req.user?.userId);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Get doctor inbox/messages
export async function getDoctorInbox(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    
    // Dummy inbox data
    const messages = [
      {
        id: "msg-001",
        patient: {
          id: "pat-001",
          name: "John Doe"
        },
        subject: "Question about medication",
        preview: "I have a question about the new medication you prescribed...",
        receivedDate: new Date().toISOString(),
        status: "unread",
        priority: "normal",
        type: "question"
      },
      {
        id: "msg-002",
        patient: {
          id: "pat-002",
          name: "Jane Smith"
        },
        subject: "Appointment rescheduling",
        preview: "I need to reschedule my appointment next week...",
        receivedDate: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
        status: "read",
        priority: "high",
        type: "appointment"
      },
      {
        id: "msg-003",
        patient: {
          id: "pat-003",
          name: "Bob Johnson"
        },
        subject: "Side effects concern",
        preview: "I'm experiencing some side effects from the medication...",
        receivedDate: new Date(Date.now() - 3600000 * 5).toISOString(), // 5 hours ago
        status: "unread",
        priority: "high",
        type: "concern"
      },
      {
        id: "msg-004",
        patient: {
          id: "pat-004",
          name: "Alice Brown"
        },
        subject: "Thank you note",
        preview: "Thank you for the excellent care during my visit...",
        receivedDate: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        status: "read",
        priority: "low",
        type: "feedback"
      }
    ];

    res.json({
      success: true,
      data: {
        messages,
        totalCount: messages.length,
        unreadCount: messages.filter(msg => msg.status === 'unread').length,
        highPriorityCount: messages.filter(msg => msg.priority === 'high').length
      }
    });
  } catch (error) {
    console.error("Error fetching doctor inbox:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}