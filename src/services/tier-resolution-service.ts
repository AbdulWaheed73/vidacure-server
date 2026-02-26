import type { ProviderTier } from "../types/provider-type";

type TierOverride = {
  providerId: { toString(): string };
  tier: "free" | "premium";
  setBy?: string;
  setAt?: Date;
};

type TierResolutionInput = {
  providerId: string;
  providerType: string;
  patientPlanType?: "lifestyle" | "medical";
  overrides?: TierOverride[];
};

type TierResolutionResult = {
  tier: ProviderTier;
  source: "override" | "default";
};

/**
 * Resolves a patient's tier for a given provider.
 * 1. Check providerTierOverrides for explicit admin override → use it
 * 2. Otherwise apply defaults: physician + active medical plan → "premium", everything else → "free"
 */
export const resolveProviderTier = ({
  providerId,
  providerType,
  patientPlanType,
  overrides = [],
}: TierResolutionInput): TierResolutionResult => {
  // Check for explicit admin override
  const override = overrides.find(
    (o) => o.providerId.toString() === providerId
  );

  if (override) {
    return { tier: override.tier, source: "override" };
  }

  // Default logic: physician + medical plan → premium, everything else → free
  if (providerType === "physician" && patientPlanType === "medical") {
    return { tier: "premium", source: "default" };
  }

  return { tier: "free", source: "default" };
};
