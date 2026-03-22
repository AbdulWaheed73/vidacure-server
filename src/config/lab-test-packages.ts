import { LabTestPackage } from "../types/giddir-types";

// Static configuration of available lab test packages.
// Product codes correspond to Giddir Admin-configured test packages.
// Update the productCode values with your actual Giddir product codes.
export const LAB_TEST_PACKAGES: LabTestPackage[] = [
  {
    id: "blood73",
    productCode: "se_albafides_care_ab_blood73",
    name: "Blood Test",
    nameSv: "Blodprov",
    description: "Order a blood test as part of your treatment plan.",
    descriptionSv: "Beställ ett blodprov som en del av din behandlingsplan.",
    analyses: [],
    priceAmountOre: 49900,
    priceCurrency: "sek",
  },
];
