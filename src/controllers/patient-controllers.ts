import { Request, Response } from "express";
import PatientSchema from "../schemas/patient-schema";
import { PatientT } from "../types/patient-type";

export const getAllPatients = async (req: Request, res: Response): Promise<void> => {
    try {
      const owners = await PatientSchema.find()
      res.status(200).json(owners);
    } catch (error) {
      res.status(500).json({ error: "Error fetching owners" });
    }
  };