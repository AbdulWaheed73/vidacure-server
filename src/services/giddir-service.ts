import crypto from "crypto";
import { decryptSSN } from "./auth-service";
import {
  GiddirCachedToken,
  FhirBundle,
  FhirObservationResource,
  LabTestResult,
  GiddirSubStatus,
  FhirServiceRequestResource,
} from "../types/giddir-types";

const GIDDIR_BASE_URL = process.env.GIDDIR_BASE_URL || "";
const GIDDIR_USERNAME = process.env.GIDDIR_USERNAME || "";
const GIDDIR_PASSWORD = process.env.GIDDIR_PASSWORD || "";
const GIDDIR_APP_ID = process.env.GIDDIR_APP_ID || "";
const GIDDIR_PRACTITIONER_EMAIL = process.env.GIDDIR_PRACTITIONER_EMAIL || "";

// In-memory token cache
let cachedToken: GiddirCachedToken | null = null;
// Mutex to prevent concurrent authentication calls
let authPromise: Promise<GiddirCachedToken> | null = null;

// ============================================================================
// Authentication
// ============================================================================

async function authenticate(): Promise<GiddirCachedToken> {
  const response = await fetch(`${GIDDIR_BASE_URL}/api/login/GIDDIR2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-giddir-app": GIDDIR_APP_ID,
    },
    body: JSON.stringify({
      UserName: GIDDIR_USERNAME,
      Password: GIDDIR_PASSWORD,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Giddir authentication failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  const loginData = json.data || json;
  console.log("Giddir login response:", JSON.stringify({
    email: loginData.email,
    userName: loginData.userName,
    roles: loginData.roles,
    userExternalId: loginData.userExternalId,
    personId: loginData.personId,
    expirationTime: loginData.expirationTime,
    success: loginData.success,
  }));

  // Token is nested under data.token
  const token = loginData.token;
  if (!token) {
    throw new Error("Giddir login response missing token");
  }

  // expirationTime can be an ISO datetime ("2024-01-15T12:00:00Z") or a duration ("05:00:00")
  const expTimeStr = loginData.expirationTime;
  let expiresAt: number;

  if (expTimeStr && expTimeStr.includes("T")) {
    // ISO datetime format — parse directly and subtract 5-min buffer
    expiresAt = new Date(expTimeStr).getTime() - 5 * 60 * 1000;
  } else {
    // Duration format like "05:00:00" — parse hours and add to now
    const parts = (expTimeStr || "05:00:00").split(":").map(Number);
    const hours = parts[0] || 5;
    expiresAt = Date.now() + (hours * 60 * 60 * 1000) - 5 * 60 * 1000;
  }

  cachedToken = {
    token,
    expiresAt,
  };

  console.log(`✅ Giddir authentication successful (expires in ${Math.round((expiresAt - Date.now()) / 60000)} min)`);
  return cachedToken;
}

async function getAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  // Use a mutex so parallel requests share a single auth call
  if (!authPromise) {
    authPromise = authenticate().finally(() => {
      authPromise = null;
    });
  }

  const result = await authPromise;
  return result.token;
}

// ============================================================================
// Generic API Request Helper
// ============================================================================

async function makeGiddirRequest(
  endpoint: string,
  options: RequestInit = {},
  retried = false
): Promise<Response> {
  const token = await getAuthToken();
  const method = (options.method || "GET").toUpperCase();

  // Send both Authorization and Cookie headers for all requests
  // (Endpoint 6 in docs uses both; some GET endpoints need Cookie, POST needs Bearer)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Cookie: `Token=${token}`,
    "x-giddir-app": GIDDIR_APP_ID,
    ...(options.headers as Record<string, string> || {}),
  };

  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  const url = `${GIDDIR_BASE_URL}${endpoint}`;
  console.log(`🔗 Giddir request: ${method} ${url}`);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Retry once on 401
  if (response.status === 401 && !retried) {
    console.log("⚠️ Giddir token expired, re-authenticating...");
    cachedToken = null;
    return makeGiddirRequest(endpoint, options, true);
  }

  return response;
}

// ============================================================================
// FHIR Bundle Builder
// ============================================================================

export type PatientDataForOrder = {
  encryptedSsn: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  gender?: string;
  dateOfBirth?: string;
};

export function buildFhirOrderBundle(
  patientData: PatientDataForOrder,
  productCode: string,
  trackingId: string
): FhirBundle {
  const ssn = decryptSSN(patientData.encryptedSsn);

  // Build telecom array matching Giddir's expected format
  const telecom: Array<{ system: string; value: string }> = [];
  if (patientData.email) {
    telecom.push({ system: "email", value: patientData.email });
  }

  const bundle: FhirBundle = {
    resourceType: "Bundle",
    entry: [
      {
        resource: {
          resourceType: "Patient",
          identifier: [
            {
              system: "http://electronichealth.se/identifier/personnummer",
              value: ssn,
            },
          ],
          name: patientData.family_name || patientData.given_name
            ? [
                {
                  family: patientData.family_name || "",
                  given: patientData.given_name
                    ? [patientData.given_name]
                    : [],
                },
              ]
            : undefined,
          telecom: telecom.length > 0 ? telecom : undefined,
          gender: patientData.gender || undefined,
          birthDate: patientData.dateOfBirth || undefined,
        },
      },
      {
        resource: {
          resourceType: "ServiceRequest",
          identifier: [
            {
              system: `http://giddir.com/${GIDDIR_APP_ID}-id`,
              value: trackingId,
            },
            {
              system: "http://giddir.com/product-code",
              value: productCode,
            },
          ],
          requester: {
            type: "Practitioner",
            identifier: {
              system: "http://giddir.com/external-id",
              value: GIDDIR_PRACTITIONER_EMAIL,
            },
          },
          subject: {
            type: "Patient",
            identifier: {
              system: "http://electronichealth.se/identifier/personnummer",
              value: ssn,
            },
          },
        } as FhirServiceRequestResource,
      },
    ],
  };

  return bundle;
}

// ============================================================================
// Place Order
// ============================================================================

export async function placeOrder(bundle: FhirBundle): Promise<{
  success: boolean;
  serviceRequestId?: string;
  error?: string;
}> {
  try {
    const response = await makeGiddirRequest(
      "/api/externalservicerequest/order",
      {
        method: "POST",
        body: JSON.stringify(bundle),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error(`Giddir order failed (${response.status}):`, text);
      console.error("Request body sent:", JSON.stringify(bundle).substring(0, 2000));
      return { success: false, error: `Giddir API error: ${response.status} - ${text}` };
    }

    const data = await response.json();
    console.log("✅ Giddir order placed successfully:", JSON.stringify(data).substring(0, 1000));

    // Extract ServiceRequest ID from the response Bundle entries
    let serviceRequestId: string | null = null;
    if (data?.entry && Array.isArray(data.entry)) {
      for (const entry of data.entry) {
        const resource = entry?.resource || entry;
        if (resource?.resourceType === "ServiceRequest" && resource?.id) {
          serviceRequestId = resource.id;
          break;
        }
      }
    }
    // Fallback: top-level id (in case Giddir returns a flat response)
    if (!serviceRequestId) {
      serviceRequestId = data?.id || null;
    }

    return { success: true, serviceRequestId: serviceRequestId || undefined };
  } catch (error) {
    console.error("Giddir order error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Tracking ID Generator
// ============================================================================

export function generateExternalTrackingId(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString("hex");
  return `VC-${timestamp}-${random}`;
}

// ============================================================================
// Parse Observation to Result
// ============================================================================

export function parseObservationToResult(
  observation: FhirObservationResource
): LabTestResult {
  const coding = observation.code?.coding?.[0];
  const code = coding?.code || "UNKNOWN";
  const name = coding?.display || observation.code?.text || code;

  let valueType: LabTestResult["valueType"] = "absent";
  let valueQuantity: LabTestResult["valueQuantity"] | undefined;
  let valueString: string | undefined;

  if (observation.valueQuantity?.value !== undefined) {
    valueType = "quantity";
    valueQuantity = {
      value: observation.valueQuantity.value,
      unit: observation.valueQuantity.unit || "",
    };
  } else if (observation.valueString) {
    valueType = "string";
    valueString = observation.valueString;
  } else if (observation.valueCodeableConcept) {
    valueType = "codeableConcept";
    valueString =
      observation.valueCodeableConcept.coding?.[0]?.display ||
      observation.valueCodeableConcept.text ||
      "";
  }

  // Parse reference range
  const refRange = observation.referenceRange?.[0];
  const referenceRange = refRange
    ? {
        low: refRange.low?.value,
        high: refRange.high?.value,
        text: refRange.text,
      }
    : undefined;

  // Determine if out of range
  let isOutOfRange = false;
  if (
    valueType === "quantity" &&
    valueQuantity &&
    referenceRange
  ) {
    if (
      referenceRange.low !== undefined &&
      valueQuantity.value < referenceRange.low
    ) {
      isOutOfRange = true;
    }
    if (
      referenceRange.high !== undefined &&
      valueQuantity.value > referenceRange.high
    ) {
      isOutOfRange = true;
    }
  }

  // Check interpretation codes
  const interpretation = observation.interpretation?.[0]?.coding?.[0]?.code;
  if (interpretation && ["H", "HH", "L", "LL", "A", "AA"].includes(interpretation)) {
    isOutOfRange = true;
  }

  const observationId =
    observation.id ||
    observation.identifier?.[0]?.value ||
    `obs-${code}-${Date.now()}`;

  return {
    observationId,
    code,
    name,
    valueType,
    valueQuantity,
    valueString,
    referenceRange,
    isOutOfRange,
    interpretation,
    effectiveDateTime: observation.effectiveDateTime,
    note: observation.note?.[0]?.text,
  };
}

// ============================================================================
// Parse Webhook Payload
// ============================================================================

export type ParsedWebhookData = {
  trackingId?: string;
  serviceRequestId?: string;
  subStatus?: GiddirSubStatus;
  observations: FhirObservationResource[];
};

export function parseWebhookPayload(body: unknown): ParsedWebhookData {
  const result: ParsedWebhookData = {
    observations: [],
  };

  if (!body || typeof body !== "object") {
    return result;
  }

  const payload = body as Record<string, unknown>;

  // If it's a Bundle, iterate entries
  if (payload.resourceType === "Bundle" && Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      const resource = (entry as Record<string, unknown>).resource as Record<string, unknown>;
      if (!resource) continue;

      if (resource.resourceType === "ServiceRequest") {
        const sr = resource as unknown as FhirServiceRequestResource;
        extractServiceRequestData(sr, result);
      }

      if (resource.resourceType === "Observation") {
        result.observations.push(resource as unknown as FhirObservationResource);
      }
    }
  }

  // If it's a raw ServiceRequest (status update without results)
  if (payload.resourceType === "ServiceRequest") {
    const sr = payload as unknown as FhirServiceRequestResource;
    extractServiceRequestData(sr, result);
  }

  return result;
}

function extractServiceRequestData(
  sr: FhirServiceRequestResource,
  result: ParsedWebhookData
): void {
  const externalIdSystem = `http://giddir.com/${GIDDIR_APP_ID}-id`;

  // Extract tracking ID and Giddir external ID from identifiers
  if (sr.identifier) {
    for (const id of sr.identifier) {
      if (id.system === externalIdSystem) {
        result.trackingId = id.value;
      }
      if (id.system === "http://giddir.com/external-id") {
        result.serviceRequestId = id.value;
      }
    }
  }

  // Also use the ServiceRequest.id (UUID) as a fallback service request ID
  if (!result.serviceRequestId && sr.id) {
    result.serviceRequestId = sr.id;
  }

  // Extract sub-status from extensions
  if (sr.extension) {
    for (const ext of sr.extension) {
      if (
        ext.url === "http://giddir.com/sub-status" ||
        ext.url?.includes("sub-status")
      ) {
        result.subStatus = (ext.valueString || ext.valueCode) as GiddirSubStatus;
      }
    }
  }

  // Use the status field as fallback for sub-status mapping
  if (!result.subStatus && sr.status) {
    result.subStatus = sr.status as GiddirSubStatus;
  }
}

// ============================================================================
// Fetch Lab Results from Giddir
// ============================================================================

export type FetchedOrderData = {
  observations: FhirObservationResource[];
  subStatus?: GiddirSubStatus;
  serviceRequestId?: string;
};

// Endpoint 5b: GET /api/externalservicerequest/order/{id}/labResult
export async function fetchLabResults(
  giddirServiceRequestId: string
): Promise<FetchedOrderData | null> {
  try {
    const response = await makeGiddirRequest(
      `/api/externalservicerequest/order/${giddirServiceRequestId}/labResult`,
      { method: "GET" }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Giddir 5b labResult returned ${response.status} for ${giddirServiceRequestId}: ${errorText}`);

      // Don't waste time on fallbacks if it's a practitioner permission issue
      if (errorText.includes("No Practitioner Found")) {
        return null;
      }

      // Fallback: try Endpoint 6 (patientreport) for other errors
      return fetchPatientReport(giddirServiceRequestId);
    }

    return parseLabResultBundle(await response.json());
  } catch (error) {
    console.error(`Error fetching lab results for ${giddirServiceRequestId}:`, error);
    return null;
  }
}

// Endpoint 5a: GET /api/externalservicerequest/{app}/{ext-id}/labResult
export async function fetchLabResultsByTrackingId(
  trackingId: string
): Promise<FetchedOrderData | null> {
  try {
    const response = await makeGiddirRequest(
      `/api/externalservicerequest/${GIDDIR_APP_ID}/${trackingId}/labResult`,
      { method: "GET" }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Giddir 5a labResult returned ${response.status} for ${trackingId}: ${errorText}`);
      return null;
    }

    return parseLabResultBundle(await response.json());
  } catch (error) {
    console.error(`Error fetching lab results by tracking ID ${trackingId}:`, error);
    return null;
  }
}

// Endpoint 6: GET /api/externalservicerequest/order/{id}/patientreport
async function fetchPatientReport(
  giddirServiceRequestId: string
): Promise<FetchedOrderData | null> {
  try {
    const response = await makeGiddirRequest(
      `/api/externalservicerequest/order/${giddirServiceRequestId}/patientreport`,
      { method: "GET" }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Giddir Endpoint 6 patientreport returned ${response.status} for ${giddirServiceRequestId}: ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log(`Giddir patientreport response:`, JSON.stringify(data).substring(0, 1000));

    const result: FetchedOrderData = {
      observations: [],
      serviceRequestId: giddirServiceRequestId,
    };

    // Parse the patientreport format into our normalized structure
    if (data.finalAssesmentPublished?.signed) {
      result.subStatus = "signed";
    }

    // Parse contents[] into observation-like results
    if (Array.isArray(data.contents)) {
      for (const content of data.contents) {
        if (content.resultValue) {
          const rv = content.resultValue;
          const obs: FhirObservationResource = {
            resourceType: "Observation",
            id: content.resourceReference?.replace("Observation/", "") || `report-${rv.markerCode}`,
            status: "final",
            code: {
              coding: rv.markerCode
                ? [{ system: "http://giddir.com/npu", code: rv.markerCode }]
                : [],
              text: rv.text || rv.markerCode || "",
            },
            valueQuantity:
              rv.value !== undefined
                ? { value: rv.value, unit: rv.unit || "" }
                : undefined,
            referenceRange:
              rv.low !== undefined || rv.high !== undefined
                ? [{ low: rv.low !== undefined ? { value: rv.low } : undefined, high: rv.high !== undefined ? { value: rv.high } : undefined }]
                : undefined,
          };
          result.observations.push(obs);
        }
      }
    }

    if (result.observations.length > 0 && !result.subStatus) {
      result.subStatus = "final-report";
    }

    return result;
  } catch (error) {
    console.error(`Error fetching patient report for ${giddirServiceRequestId}:`, error);
    return null;
  }
}

// Parse FHIR Bundle response from Endpoint 5a/5b
function parseLabResultBundle(data: Record<string, unknown>): FetchedOrderData {
  const result: FetchedOrderData = { observations: [] };

  if (data?.entry && Array.isArray(data.entry)) {
    for (const entry of data.entry) {
      const resource = (entry as Record<string, unknown>)?.resource || entry;
      if (!(resource as Record<string, unknown>)?.resourceType) continue;

      const res = resource as Record<string, unknown>;

      if (res.resourceType === "Observation") {
        result.observations.push(res as unknown as FhirObservationResource);
      }

      if (res.resourceType === "ServiceRequest") {
        const extensions = res.extension as Array<{ url: string; valueString?: string }> | undefined;
        if (extensions) {
          for (const ext of extensions) {
            if (ext.url?.includes("sub-status") && ext.valueString) {
              result.subStatus = ext.valueString as GiddirSubStatus;
            }
          }
        }
        if (res.id) {
          result.serviceRequestId = res.id as string;
        }
      }
    }
  }

  if (!result.subStatus && result.observations.length > 0) {
    const allFinal = result.observations.every(
      (obs) => obs.status === "final"
    );
    result.subStatus = allFinal ? "final-report" : "partial-report";
  }

  return result;
}

export function isGiddirConfigured(): boolean {
  return !!(GIDDIR_BASE_URL && GIDDIR_USERNAME && GIDDIR_PASSWORD && GIDDIR_APP_ID);
}
