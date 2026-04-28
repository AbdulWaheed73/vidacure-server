// Validates Swedish phone numbers.
// Accepts: +46 followed by 8–9 digits (mobile/landline, no leading 0),
// or 0 followed by 8–9 digits. Spaces, dashes, and parentheses are ignored.
export const isValidSwedishPhone = (value: string): boolean => {
  if (typeof value !== "string") return false;
  const cleaned = value.replace(/[\s\-()]/g, "");
  return /^(\+46\d{8,9}|0\d{8,9})$/.test(cleaned);
};

export const normalizeSwedishPhone = (value: string): string => {
  return value.replace(/[\s\-()]/g, "");
};
