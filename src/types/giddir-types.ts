import { Types } from "mongoose";

// ============================================================================
// Giddir Authentication Types
// ============================================================================

export type GiddirLoginResponse = {
  token: string;
  expiration: string;
};

export type GiddirCachedToken = {
  token: string;
  expiresAt: number; // Unix timestamp in ms
};

// ============================================================================
// FHIR R4 Resource Types
// ============================================================================

export type FhirIdentifier = {
  system: string;
  value: string;
};

export type FhirExtension = {
  url: string;
  valueString?: string;
  valueCode?: string;
  valueReference?: {
    reference?: string;
    display?: string;
  };
};

export type FhirCoding = {
  system?: string;
  code: string;
  display?: string;
};

export type FhirCodeableConcept = {
  coding?: FhirCoding[];
  text?: string;
};

export type FhirPatientResource = {
  resourceType: "Patient";
  identifier: FhirIdentifier[];
  name?: Array<{
    use?: string;
    family?: string;
    given?: string[];
  }>;
  telecom?: Array<{
    system: string;
    value: string;
    use?: string;
  }>;
  gender?: string;
  birthDate?: string;
};

export type FhirServiceRequestResource = {
  resourceType: "ServiceRequest";
  id?: string;
  identifier: FhirIdentifier[];
  code?: FhirCodeableConcept;
  status?: string;
  intent?: string;
  subject: {
    type?: string;
    identifier?: FhirIdentifier;
    reference?: string;
    display?: string;
  };
  requester?: {
    type?: string;
    identifier?: FhirIdentifier;
    reference?: string;
    display?: string;
  };
  performer?: Array<{
    type?: string;
    identifier?: FhirIdentifier;
    reference?: string;
    display?: string;
  }>;
  contained?: Array<Record<string, unknown>>;
  extension?: FhirExtension[];
};

export type FhirQuantity = {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
};

export type FhirReferenceRange = {
  low?: FhirQuantity;
  high?: FhirQuantity;
  text?: string;
};

export type FhirObservationResource = {
  resourceType: "Observation";
  id?: string;
  identifier?: FhirIdentifier[];
  status: string;
  code: FhirCodeableConcept;
  subject?: {
    reference?: string;
    identifier?: FhirIdentifier;
  };
  valueQuantity?: FhirQuantity;
  valueString?: string;
  valueCodeableConcept?: FhirCodeableConcept;
  referenceRange?: FhirReferenceRange[];
  interpretation?: FhirCodeableConcept[];
  note?: Array<{ text: string }>;
  effectiveDateTime?: string;
};

export type FhirBundleEntry = {
  fullUrl?: string;
  resource: FhirPatientResource | FhirServiceRequestResource | FhirObservationResource;
};

export type FhirBundle = {
  resourceType: "Bundle";
  type?: "transaction" | "message" | "collection" | "searchset";
  entry: FhirBundleEntry[];
};

// ============================================================================
// Giddir Status & Webhook Types
// ============================================================================

export type GiddirSubStatus =
  | "draft"
  | "created"
  | "sending"
  | "sent"
  | "sent-failed"
  | "accepted"
  | "received"
  | "sample-received"
  | "partial-report"
  | "final-report"
  | "updated-final-report"
  | "signed"
  | "completed-updated"
  | "revoked";

export type GiddirWebhookEvent =
  | "service-request-status-update"
  | "service-request-result";

// ============================================================================
// Lab Test Result (normalized from FHIR Observation)
// ============================================================================

export type LabTestResult = {
  observationId: string;
  code: string;
  name: string;
  valueType: "quantity" | "string" | "codeableConcept" | "absent";
  valueQuantity?: {
    value: number;
    unit: string;
  };
  valueString?: string;
  referenceRange?: {
    low?: number;
    high?: number;
    text?: string;
  };
  isOutOfRange: boolean;
  interpretation?: string;
  effectiveDateTime?: string;
  note?: string;
};

// ============================================================================
// Lab Test Package Configuration
// ============================================================================

export type LabTestAnalysis = {
  code: string;
  name: string;
  nameSv: string;
};

export type LabTestPackage = {
  id: string;
  productCode: string;
  name: string;
  nameSv: string;
  description: string;
  descriptionSv: string;
  analyses: LabTestAnalysis[];
  priceAmountOre: number;
  priceCurrency: string;
};

// ============================================================================
// Lab Test Payment
// ============================================================================

export type LabTestPaymentStatus = "pending_payment" | "paid" | "payment_failed";

// ============================================================================
// Lab Test Order (MongoDB Document Type)
// ============================================================================

export type LabTestStatusHistoryEntry = {
  status: GiddirSubStatus;
  timestamp: Date;
};

export type LabTestOrderT = {
  _id?: Types.ObjectId;
  patient: Types.ObjectId;
  giddirServiceRequestId?: string;
  externalTrackingId?: string;
  testPackage: {
    id: string;
    productCode: string;
    name: string;
    nameSv: string;
  };
  status: GiddirSubStatus;
  paymentStatus?: LabTestPaymentStatus;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  statusHistory: LabTestStatusHistoryEntry[];
  results: LabTestResult[];
  labComment?: string;
  orderedAt: Date;
  completedAt?: Date;
  draftExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// ============================================================================
// API Request/Response Types
// ============================================================================

export type PlaceLabTestOrderRequest = {
  testPackageId: string;
};

export type PlaceLabTestOrderResponse = {
  success: boolean;
  order: LabTestOrderT;
  message: string;
};

export type GetLabTestOrdersResponse = {
  success: boolean;
  orders: LabTestOrderT[];
};

export type GetLabTestOrderResponse = {
  success: boolean;
  order: LabTestOrderT;
};

export type CreateLabTestCheckoutResponse = {
  sessionId: string;
  url: string;
  orderId: string;
};

export type GetLabTestPackagesResponse = {
  success: boolean;
  packages: LabTestPackage[];
};
