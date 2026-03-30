import { LabTestPackage } from "../types/giddir-types";

// Static configuration of available lab test packages.
// Product codes correspond to Giddir Admin-configured test packages.
// Update the productCode values with your actual Giddir product codes.
export const LAB_TEST_PACKAGES: LabTestPackage[] = [
  {
    id: "viktkontroll",
    productCode: "se_albafides_care_ab_viktkontroll",
    name: "Blood Test",
    nameSv: "Blodprov",
    description: "Order a blood test as part of your treatment plan.",
    descriptionSv: "Beställ ett blodprov som en del av din behandlingsplan.",
    analyses: [],
    priceAmountOre: 34950,
    originalPriceAmountOre: 69900,
    priceCurrency: "sek",
  },
];
