export type CalendlyEventType = {
  uri: string;
  name: string;
  scheduling_url: string;
  pooling_type: string | null;
  active: boolean;
  slug?: string;
  duration?: number;
  kind?: string;
  description_plain?: string;
  color?: string;
};

export type CalendlyUserProfile = {
  uri: string;
  name: string;
  email: string;
  avatar_url?: string;
  scheduling_url: string;
  slug: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type CalendlySchedulingLink = {
  booking_url: string;
  owner: string;
  owner_type: string;
};

// ============================================================================
// URI-based meeting types (for tracking without email)
// ============================================================================

export type ScheduledEventDetails = {
  uri: string;
  name: string;
  status: 'active' | 'canceled';
  start_time: string;
  end_time: string;
  event_type: string;
  location: {
    type: string;
    location?: string;
    join_url?: string;
    status?: string;
  } | null;
  invitees_counter: {
    total: number;
    active: number;
    limit: number;
  };
  created_at: string;
  updated_at: string;
  event_memberships: Array<{
    user: string;
  }>;
  event_guests: Array<{
    email: string;
    created_at: string;
    updated_at: string;
  }>;
  cancellation?: {
    canceled_by: string;
    reason?: string;
    canceler_type: string;
  };
};

export type InviteeDetails = {
  uri: string;
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  status: 'active' | 'canceled';
  timezone: string | null;
  event: string;
  created_at: string;
  updated_at: string;
  tracking: {
    utm_campaign: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_content: string | null;
    utm_term: string | null;
  };
  questions_and_answers: Array<{
    question: string;
    answer: string;
    position: number;
  }>;
  cancel_url: string;
  reschedule_url: string;
  rescheduled: boolean;
  old_invitee: string | null;
  new_invitee: string | null;
  no_show: { marked_at: string } | null;
};