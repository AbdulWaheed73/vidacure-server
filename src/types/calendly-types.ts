export type CalendlyEventType = {
  uri: string;
  name: string;
  scheduling_url: string;
  pooling_type: string | null;
  active: boolean;
};

export type CalendlySchedulingLink = {
  booking_url: string;
  owner: string;
  owner_type: string;
};