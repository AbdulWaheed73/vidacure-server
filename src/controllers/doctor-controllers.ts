import { Response } from "express";
import { Types } from "mongoose";
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

    await auditDatabaseOperation(req, 'doctor_dashboard_accessed', 'READ', doctorId);

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    await auditDatabaseError(req, 'doctor_dashboard', 'READ', error, req.user?.userId);
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

    await auditDatabaseOperation(req, 'doctor_appointments_accessed', 'READ', req.user?.userId);

    res.json({
      success: true,
      data: {
        appointments,
        totalCount: appointments.length,
        todayCount: appointments.filter(apt => apt.date === new Date().toISOString().split('T')[0]).length
      }
    });
  } catch (error) {
    await auditDatabaseError(req, 'doctor_appointments', 'READ', error, req.user?.userId);
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

    // Pagination
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 0));
    const totalCount = allPrescriptionRequests.length;

    const paginatedRequests = limit > 0
      ? allPrescriptionRequests.slice((page - 1) * limit, page * limit)
      : allPrescriptionRequests;

    res.json({
      success: true,
      data: {
        prescriptionRequests: paginatedRequests,
        totalCount,
        pendingCount: allPrescriptionRequests.filter(req => req.status === 'pending').length,
        approvedCount: allPrescriptionRequests.filter(req => req.status === 'approved').length,
        deniedCount: allPrescriptionRequests.filter(req => req.status === 'denied').length,
        underReviewCount: allPrescriptionRequests.filter(req => req.status === 'under_review').length,
        page,
        limit: limit || totalCount,
        totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
        hasMore: limit > 0 ? page * limit < totalCount : false
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

export async function getDoctorPatients(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const patients = await PatientSchema.find({ doctor: doctorId })
      .select("name given_name family_name email dateOfBirth gender height bmi createdAt updatedAt")
      .sort({ name: 1 })
      .lean();

    await auditDatabaseOperation(req, "get_doctor_patients", "READ", doctorId, {
      count: patients.length
    });

    const formattedPatients = patients.map((patient) => ({
      id: patient._id?.toString() ?? "",
      name: patient.name,
      givenName: patient.given_name,
      familyName: patient.family_name,
      email: patient.email ?? null,
      dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString() : null,
      gender: patient.gender ?? null,
      height: patient.height ?? null,
      bmi: patient.bmi ?? null,
      createdAt: patient.createdAt ? new Date(patient.createdAt).toISOString() : null,
      updatedAt: patient.updatedAt ? new Date(patient.updatedAt).toISOString() : null
    }));

    res.status(200).json({
      patients: formattedPatients
    });
  } catch (error) {
    console.error("Error fetching doctor patients:", error);
    await auditDatabaseError(req, "get_doctor_patients", "READ", error, req.user?.userId);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

export async function getPatientProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    const { patientId, limit } = req.query;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (typeof patientId !== "string" || !Types.ObjectId.isValid(patientId)) {
      res.status(400).json({ error: "A valid patientId query parameter is required" });
      return;
    }

    const limitValue = Array.isArray(limit) ? limit[0] : limit;
    if (typeof limitValue !== "string" || limitValue.trim() === "") {
      res.status(400).json({ error: "A numeric limit query parameter is required" });
      return;
    }

    const entriesLimit = parseInt(limitValue, 10);
    if (Number.isNaN(entriesLimit) || entriesLimit <= 0) {
      res.status(400).json({ error: "Limit must be a positive integer" });
      return;
    }

    const patient = await PatientSchema.findOne({
      _id: patientId,
      doctor: doctorId
    }).lean();

    if (!patient) {
      await auditDatabaseError(
        req,
        "get_patient_profile",
        "READ",
        new Error("Patient not found or not assigned to doctor"),
        patientId
      );
      res.status(404).json({ error: "Patient not found or not assigned to this doctor" });
      return;
    }

    await auditDatabaseOperation(req, "get_patient_profile", "READ", patientId, {
      limit: entriesLimit
    });

    const weightHistory = Array.isArray(patient.weightHistory)
      ? [...patient.weightHistory]
          .sort((a, b) => {
            const aDate = a.date ? new Date(a.date).getTime() : 0;
            const bDate = b.date ? new Date(b.date).getTime() : 0;
            return bDate - aDate;
          })
          .slice(0, entriesLimit)
          .map((entry) => ({
            weight: entry.weight,
            date: entry.date ? new Date(entry.date).toISOString() : null,
            sideEffects: entry.sideEffects ?? null,
            notes: entry.notes ?? null
          }))
      : [];

    const prescriptionRequests = Array.isArray(patient.prescriptionRequests)
      ? [...patient.prescriptionRequests]
          .sort((a, b) => {
            const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bDate - aDate;
          })
          .slice(0, entriesLimit)
          .map((request) => ({
            id: request._id ? request._id.toString() : undefined,
            status: request.status,
            currentWeight: request.currentWeight,
            hasSideEffects: request.hasSideEffects,
            sideEffectsDescription: request.sideEffectsDescription ?? null,
            medicationName: request.medicationName ?? null,
            dosage: request.dosage ?? null,
            usageInstructions: request.usageInstructions ?? null,
            dateIssued: request.dateIssued ? new Date(request.dateIssued).toISOString() : null,
            validTill: request.validTill ? new Date(request.validTill).toISOString() : null,
            createdAt: request.createdAt ? new Date(request.createdAt).toISOString() : null,
            updatedAt: request.updatedAt ? new Date(request.updatedAt).toISOString() : null
          }))
      : [];

    const prescription = patient.prescription
      ? {
          medicationDetails: patient.prescription.medicationDetails ?? null,
          validFrom: patient.prescription.validFrom
            ? new Date(patient.prescription.validFrom).toISOString()
            : null,
          validTo: patient.prescription.validTo
            ? new Date(patient.prescription.validTo).toISOString()
            : null,
          status: patient.prescription.status ?? null,
          updatedAt: patient.prescription.updatedAt
            ? new Date(patient.prescription.updatedAt).toISOString()
            : null
        }
      : null;

    res.status(200).json({
      patientProfile: {
        id: patient._id?.toString() ?? patientId,
        name: patient.name,
        givenName: patient.given_name,
        familyName: patient.family_name,
        email: patient.email ?? null,
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth).toISOString() : null,
        gender: patient.gender ?? null,
        height: patient.height ?? null,
        bmi: patient.bmi ?? null,
        weightHistory,
        prescription,
        prescriptionRequests
      },
      limits: {
        weightHistory: entriesLimit,
        prescriptionRequests: entriesLimit
      }
    });
  } catch (error) {
    console.error("Error fetching patient profile:", error);
    await auditDatabaseError(
      req,
      "get_patient_profile",
      "READ",
      error,
      typeof req.query.patientId === "string" ? req.query.patientId : undefined
    );
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Get patient questionnaire
export async function getPatientQuestionnaire(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;
    const { patientId } = req.query;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    if (typeof patientId !== "string" || !Types.ObjectId.isValid(patientId)) {
      res.status(400).json({ error: "A valid patientId query parameter is required" });
      return;
    }

    const patient = await PatientSchema.findOne({
      _id: patientId,
      doctor: doctorId
    })
      .select("questionnaire")
      .lean();

    if (!patient) {
      await auditDatabaseError(
        req,
        "get_patient_questionnaire",
        "READ",
        new Error("Patient not found or not assigned to doctor"),
        patientId
      );
      res.status(404).json({ error: "Patient not found or not assigned to this doctor" });
      return;
    }

    await auditDatabaseOperation(req, "get_patient_questionnaire", "READ", patientId);

    const questionnaire = Array.isArray(patient.questionnaire)
      ? patient.questionnaire.map((entry) => ({
          questionId: entry.questionId,
          answer: entry.answer ?? ""
        }))
      : [];

    res.status(200).json({ questionnaire });
  } catch (error) {
    console.error("Error fetching patient questionnaire:", error);
    await auditDatabaseError(
      req,
      "get_patient_questionnaire",
      "READ",
      error,
      typeof req.query.patientId === "string" ? req.query.patientId : undefined
    );
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Get doctor profile
export async function getDoctorProfile(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const doctorId = req.user?.userId;

    if (!doctorId) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const doctor = await DoctorSchema.findById(doctorId);

    if (!doctor) {
      await auditDatabaseError(req, "get_doctor_profile", "READ", new Error("Doctor not found"), doctorId);
      res.status(404).json({ error: "Doctor not found" });
      return;
    }

    await auditDatabaseOperation(req, "get_doctor_profile", "READ", doctorId);

    res.status(200).json({
      profile: {
        userId: doctor._id,
        name: doctor.name,
        givenName: doctor.given_name,
        familyName: doctor.family_name,
        email: doctor.email,
        role: doctor.role,
        // calendlyUserUri: doctor.calendlyUserUri,
        // eventTypes: doctor.eventTypes,
        createdAt: doctor.createdAt,
        updatedAt: doctor.updatedAt
      }
    });
  } catch (error) {
    console.error("Error fetching doctor profile:", error);
    await auditDatabaseError(req, "get_doctor_profile", "READ", error, req.user?.userId);
    res.status(500).json({ error: "Error fetching doctor profile" });
  }
}

// Get doctor inbox/messages
// export async function getDoctorInbox(
//   req: AuthenticatedRequest,
//   res: Response
// ): Promise<void> {
//   try {

//     const messages = [
//       {
//         id: "msg-001",
//         patient: {
//           id: "pat-001",
//           name: "John Doe"
//         },
//         subject: "Question about medication",
//         preview: "I have a question about the new medication you prescribed...",
//         receivedDate: new Date().toISOString(),
//         status: "unread",
//         priority: "normal",
//         type: "question"
//       },
//       {
//         id: "msg-002",
//         patient: {
//           id: "pat-002",
//           name: "Jane Smith"
//         },
//         subject: "Appointment rescheduling",
//         preview: "I need to reschedule my appointment next week...",
//         receivedDate: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
//         status: "read",
//         priority: "high",
//         type: "appointment"
//       },
//       {
//         id: "msg-003",
//         patient: {
//           id: "pat-003",
//           name: "Bob Johnson"
//         },
//         subject: "Side effects concern",
//         preview: "I'm experiencing some side effects from the medication...",
//         receivedDate: new Date(Date.now() - 3600000 * 5).toISOString(), // 5 hours ago
//         status: "unread",
//         priority: "high",
//         type: "concern"
//       },
//       {
//         id: "msg-004",
//         patient: {
//           id: "pat-004",
//           name: "Alice Brown"
//         },
//         subject: "Thank you note",
//         preview: "Thank you for the excellent care during my visit...",
//         receivedDate: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
//         status: "read",
//         priority: "low",
//         type: "feedback"
//       }
//     ];

//     res.json({
//       success: true,
//       data: {
//         messages,
//         totalCount: messages.length,
//         unreadCount: messages.filter(msg => msg.status === 'unread').length,
//         highPriorityCount: messages.filter(msg => msg.priority === 'high').length
//       }
//     });
//   } catch (error) {
//     console.error("Error fetching doctor inbox:", error);
//     res.status(500).json({
//       error: "Internal server error",
//       details: error instanceof Error ? error.message : "Unknown error"
//     });
//   }
// }
