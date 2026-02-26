import PatientSchema from "../schemas/patient-schema";
import ProviderSchema from "../schemas/provider-schema";

/**
 * @deprecated No longer called. Provider visibility is now universal (all active providers
 * visible to all patients) and tier resolution handles free/premium access automatically.
 * Kept for reference only.
 *
 * Auto-assigns an active physician provider to a patient (medical plan).
 * Uses round-robin logic — picks the physician with the fewest assigned patients.
 * No-op if the patient already has a physician assigned.
 */
export const assignPhysicianToPatient = async (patientId: string) => {
  try {
    console.log(`[Provider Assignment] Starting physician assignment for patient: ${patientId}`);

    const patient = await PatientSchema.findById(patientId);
    if (!patient) {
      console.error("[Provider Assignment] Patient not found:", patientId);
      return null;
    }

    // Get all active physicians
    const physicians = await ProviderSchema.find({
      providerType: "physician",
      isActive: true,
    });

    if (physicians.length === 0) {
      console.warn("[Provider Assignment] No active physicians in the system — skipping");
      return null;
    }

    // Check if patient already has a physician assigned
    const currentProviderIds = (patient.providers || []).map((p: any) => p.toString());
    const alreadyHasPhysician = physicians.some((doc) =>
      currentProviderIds.includes(doc._id.toString())
    );

    if (alreadyHasPhysician) {
      console.log("[Provider Assignment] Patient already has a physician assigned — skipping");
      return null;
    }

    // Round-robin: find physician with least patients
    const physicianCounts = await Promise.all(
      physicians.map(async (physician) => {
        const count = await PatientSchema.countDocuments({ providers: physician._id });
        return { physician, count };
      })
    );

    physicianCounts.sort((a, b) => a.count - b.count);
    const selected = physicianCounts[0];

    // Assign
    await PatientSchema.findByIdAndUpdate(patientId, {
      $push: { providers: selected.physician._id },
    });

    console.log(
      `[Provider Assignment] Assigned physician "${selected.physician.name}" (${selected.physician._id}) to patient ${patientId} (had ${selected.count} patients)`
    );

    return {
      providerId: selected.physician._id,
      providerName: selected.physician.name,
      previousPatientCount: selected.count,
    };
  } catch (error) {
    console.error("[Provider Assignment] Error in assignPhysicianToPatient:", error);
    throw error;
  }
};
