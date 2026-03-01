import { LabTestPackage } from "../types/giddir-types";

// Static configuration of available lab test packages.
// Product codes correspond to Giddir Admin-configured test packages.
// Update the productCode values with your actual Giddir product codes.
export const LAB_TEST_PACKAGES: LabTestPackage[] = [
  {
    id: "blood73",
    productCode: "se_albafides_care_ab_blood73",
    name: "Basic Health Panel",
    nameSv: "Grundläggande hälsopanel",
    description: "Essential blood markers including blood sugar, cholesterol, and liver function.",
    descriptionSv: "Grundläggande blodmarkörer inklusive blodsocker, kolesterol och leverfunktion.",
    analyses: [
      { code: "GLU", name: "Glucose (fasting)", nameSv: "Glukos (fastande)" },
      { code: "HBA1C", name: "HbA1c", nameSv: "HbA1c" },
      { code: "CHOL", name: "Total Cholesterol", nameSv: "Totalkolesterol" },
      { code: "HDL", name: "HDL Cholesterol", nameSv: "HDL-kolesterol" },
      { code: "LDL", name: "LDL Cholesterol", nameSv: "LDL-kolesterol" },
      { code: "TG", name: "Triglycerides", nameSv: "Triglycerider" },
      { code: "ALAT", name: "ALAT (liver)", nameSv: "ALAT (lever)" },
      { code: "ASAT", name: "ASAT (liver)", nameSv: "ASAT (lever)" },
    ],
    priceAmountOre: 29900,
    priceCurrency: "sek",
  },
];
