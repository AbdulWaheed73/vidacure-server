import { Types } from "mongoose";
import PatientSchema from "../schemas/patient-schema";
import DoctorSchema from "../schemas/doctor-schema";
import AdminSchema from "../schemas/admin-schema";

type NamedDoc = { _id: Types.ObjectId; name?: string };

/**
 * Batched read that maps user/patient/doctor/admin ids to display names.
 * Shared by the audit-log and error-log admin views (single implementation).
 */
export async function resolveUserNames(
  ids: (string | Types.ObjectId | undefined | null)[]
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
  if (unique.length === 0) return {};
  const objIds = unique
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const [patients, doctors, admins] = await Promise.all([
    PatientSchema.find({ _id: { $in: objIds } }).select("name").lean<NamedDoc[]>(),
    DoctorSchema.find({ _id: { $in: objIds } }).select("name").lean<NamedDoc[]>(),
    AdminSchema.find({ _id: { $in: objIds } }).select("name").lean<NamedDoc[]>(),
  ]);

  const map: Record<string, string> = {};
  for (const u of [...patients, ...doctors, ...admins]) {
    if (u.name) map[String(u._id)] = u.name;
  }
  return map;
}
