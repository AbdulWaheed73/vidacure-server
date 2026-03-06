import express from "express";
import PatientSchema from "../schemas/patient-schema";
import ProviderSchema from "../schemas/provider-schema";
import {
  createSingleUseLink,
  getCalendlyUserByEmail,
  getCalendlyEventTypes,
  createCalendlySchedulingLink,
} from "../services/calendly-service";
import { resolveProviderTier } from "../services/tier-resolution-service";
import { AuthenticatedRequest } from "../types/generic-types";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";

/**
 * Get ALL active providers with tier info for the authenticated patient
 * GET /api/providers/my
 */
export const getMyProviders = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const patientId = req.user?.userId;
    if (!patientId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const [patient, allActiveProviders] = await Promise.all([
      PatientSchema.findById(patientId).select("subscription providerTierOverrides"),
      ProviderSchema.find({ isActive: true }).select("name email providerType specialty bio isActive createdAt updatedAt"),
    ]);

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patientPlanType = patient.subscription?.planType;
    const overrides = patient.providerTierOverrides || [];

    const providersWithTier = allActiveProviders.map((provider) => {
      const { tier } = resolveProviderTier({
        providerId: provider._id.toString(),
        providerType: provider.providerType,
        patientPlanType,
        overrides,
      });

      return {
        ...provider.toObject(),
        tier,
      };
    });

    await auditDatabaseOperation(req, 'patient_providers_accessed', 'READ', patientId);

    res.json({ providers: providersWithTier });
  } catch (error: any) {
    await auditDatabaseError(req, 'get_patient_providers', 'READ', error, req.user?.userId);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get provider detail
 * GET /api/providers/:providerId
 */
export const getProviderDetail = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { providerId } = req.params;

    const provider = await ProviderSchema.findById(providerId)
      .select("name email providerType specialty bio isActive");

    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }

    if (!provider.isActive) {
      return res.status(404).json({ error: "Provider is no longer active" });
    }

    await auditDatabaseOperation(req, 'provider_detail_accessed', 'READ', req.user?.userId, { providerId });

    res.json({ provider });
  } catch (error: any) {
    await auditDatabaseError(req, 'get_provider_detail', 'READ', error, req.user?.userId);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generate Calendly booking link for a provider
 * POST /api/providers/booking-link
 * Body: { providerId }
 * Tier is resolved automatically — no eventType needed from client
 */
export const createProviderBookingLink = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const patientId = req.user?.userId;
    if (!patientId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { providerId } = req.body;

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    // Fetch patient and provider in parallel
    const [patient, provider] = await Promise.all([
      PatientSchema.findById(patientId).select("subscription providerTierOverrides"),
      ProviderSchema.findById(providerId),
    ]);

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    if (!provider.isActive) {
      return res.status(400).json({ error: "Provider is no longer active" });
    }

    // Resolve tier
    const { tier } = resolveProviderTier({
      providerId,
      providerType: provider.providerType,
      patientPlanType: patient.subscription?.planType,
      overrides: patient.providerTierOverrides || [],
    });

    // Get/cache calendlyUserUri
    let calendlyUserUri = provider.calendlyUserUri;
    if (!calendlyUserUri) {
      calendlyUserUri = await getCalendlyUserByEmail(provider.email) || undefined;
      if (calendlyUserUri) {
        provider.calendlyUserUri = calendlyUserUri;
        await provider.save();
      } else {
        return res.status(400).json({
          error: "Provider does not have a Calendly account configured",
          message: "Please contact admin to set up the provider's Calendly account",
        });
      }
    }

    // Get the event type name from provider config based on resolved tier
    const eventTypeName = provider.eventTypes[tier];

    // Try to create link by configured name first, fall back to first available event type
    let bookingUrl: string;
    if (eventTypeName) {
      try {
        bookingUrl = await createSingleUseLink(eventTypeName, calendlyUserUri);
      } catch {
        // Name didn't match — fall through to fallback below
        console.log(`Event type "${eventTypeName}" not found for provider ${provider.name}, falling back to first available`);
        bookingUrl = "";
      }
    } else {
      bookingUrl = "";
    }

    if (!bookingUrl) {
      const allEventTypes = await getCalendlyEventTypes(calendlyUserUri!);
      const activeEvent = allEventTypes.find(et => et.active);
      if (!activeEvent) {
        return res.status(400).json({
          error: "No active event types found on this provider's Calendly account",
        });
      }
      const link = await createCalendlySchedulingLink(activeEvent.uri, 1);
      bookingUrl = link.booking_url;
    }

    // Append UTM term for webhook tracking: provider_{patientId}_{providerId}
    const utmTerm = `provider_${patientId}_${providerId}`;
    const separator = bookingUrl.includes("?") ? "&" : "?";
    const trackingUrl = `${bookingUrl}${separator}utm_term=${utmTerm}`;

    await auditDatabaseOperation(req, 'provider_booking_link_created', 'CREATE', patientId, { providerId, tier });

    res.json({
      success: true,
      schedulingLink: trackingUrl,
      provider: {
        name: provider.name,
        providerType: provider.providerType,
      },
      tier,
    });
  } catch (error: any) {
    await auditDatabaseError(req, 'create_provider_booking_link', 'CREATE', error, req.user?.userId);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get patient's provider meetings
 * GET /api/providers/meetings/my
 */
export const getMyProviderMeetings = async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const patientId = req.user?.userId;
    if (!patientId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const patient = await PatientSchema.findById(patientId)
      .select("providerMeetings");

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const meetings = (patient.providerMeetings || [])
      .sort((a: any, b: any) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());

    await auditDatabaseOperation(req, 'provider_meetings_accessed', 'READ', patientId);

    res.json({ meetings });
  } catch (error: any) {
    await auditDatabaseError(req, 'get_provider_meetings', 'READ', error, req.user?.userId);
    res.status(500).json({ error: error.message });
  }
};
