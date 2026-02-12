export type WeightHistoryExport = {
  weight: number;
  date: string;
  sideEffects?: string;
  notes?: string;
};

export type QuestionnaireExport = {
  questionId: string;
  answer: string;
};

export type PrescriptionExport = {
  medicationDetails: string;
  validFrom: string;
  validTo: string;
  status: string;
  updatedAt: string;
};

export type PrescriptionRequestExport = {
  status: string;
  currentWeight: number;
  hasSideEffects: boolean;
  sideEffectsDescription?: string;
  medicationName?: string;
  dosage?: string;
  usageInstructions?: string;
  dateIssued?: string;
  validTill?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentExport = {
  scheduledTime: string;
  status: string;
  completedAt?: string;
  source: string;
  createdAt: string;
};

export type SubscriptionExport = {
  status: string;
  planType: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  trialStart?: string;
  trialEnd?: string;
};

export type ChatMessageExport = {
  content: string;
  senderRole: string;
  messageType: string;
  createdAt: string;
};

export type PatientDataExport = {
  exportedAt: string;
  format: 'vidacure-patient-data-v1';
  personalInfo: {
    name: string;
    givenName: string;
    familyName: string;
    email: string;
    dateOfBirth?: string;
    gender?: string;
    height?: number;
    bmi?: number;
  };
  weightHistory: WeightHistoryExport[];
  questionnaire: QuestionnaireExport[];
  prescription: PrescriptionExport | null;
  prescriptionRequests: PrescriptionRequestExport[];
  appointments: AppointmentExport[];
  subscription: SubscriptionExport | null;
  chatMessages: ChatMessageExport[];
};
