import DoctorSchema from "../schemas/doctor-schema";
import PatientSchema from "../schemas/patient-schema";

/**
 * Assigns a doctor to a patient using round-robin logic (least patients first)
 * Chat conversations are created on-demand by the Socket.IO chat service
 */
export const assignDoctorRoundRobin = async (patientId: string) => {
  try {
    console.log(`[Doctor Assignment] Starting round-robin assignment for patient: ${patientId}`);

    // Get all doctors
    const doctors = await DoctorSchema.find({ role: "doctor" });

    if (doctors.length === 0) {
      console.error("[Doctor Assignment] No doctors found in the system");
      throw new Error("No doctors available for assignment");
    }

    // Find doctor with minimum number of patients
    let selectedDoctor = doctors[0];
    let minPatients = doctors[0].patients?.length || 0;

    for (const doctor of doctors) {
      const patientCount = doctor.patients?.length || 0;
      if (patientCount < minPatients) {
        minPatients = patientCount;
        selectedDoctor = doctor;
      }
    }

    console.log(`[Doctor Assignment] Selected doctor: ${selectedDoctor.name} (ID: ${selectedDoctor._id}) with ${minPatients} patients`);

    // Update MongoDB relations
    await PatientSchema.findByIdAndUpdate(patientId, {
      doctor: selectedDoctor._id,
    });

    await DoctorSchema.findByIdAndUpdate(selectedDoctor._id, {
      $addToSet: { patients: patientId },
    });

    console.log(`[Doctor Assignment] Successfully assigned doctor ${selectedDoctor.name} to patient ${patientId}`);

    return {
      doctorId: selectedDoctor._id,
      doctorName: selectedDoctor.name,
      previousPatientCount: minPatients,
    };

  } catch (error) {
    console.error("[Doctor Assignment] Error in assignDoctorRoundRobin:", error);
    throw error;
  }
};

/**
 * Gets assignment statistics (for debugging/monitoring)
 */
export const getAssignmentStats = async () => {
  try {
    const doctors = await DoctorSchema.find({ role: "doctor" });
    const stats = doctors.map(doctor => ({
      doctorId: doctor._id,
      doctorName: doctor.name,
      patientCount: doctor.patients?.length || 0
    }));

    return stats.sort((a, b) => a.patientCount - b.patientCount);
  } catch (error) {
    console.error("[Doctor Assignment] Error getting assignment stats:", error);
    throw error;
  }
};
