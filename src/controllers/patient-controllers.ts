import { Request, Response } from "express";
import PatientSchema from "../schemas/patient-schema";
import { PatientT } from "../types/patient-type";

export const getAllPatients = async (req: Request, res: Response): Promise<void> => {
    try {
      const patients = await PatientSchema.find().populate('user', 'name given_name family_name role status');
      res.status(200).json(patients);
    } catch (error) {
      res.status(500).json({ error: "Error fetching patients" });
    }
  };