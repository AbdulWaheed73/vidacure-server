import axios, { AxiosRequestConfig } from 'axios';
import type { CalendlyEventType, CalendlySchedulingLink, CalendlyUserProfile } from '../types/calendly-types';
import { CALENDLY_LAUNCH_DATE } from '../config/calendly-config';

// Environment variables
const CALENDLY_ACCESS_TOKEN: string = process.env.CALENDLY_ACCESS_TOKEN || '';
const CALENDLY_ORG_URI: string = process.env.CALENDLY_ORG_URI || '';
const CALENDLY_BASE_URL = 'https://api.calendly.com';

// Utility function for making API requests
async function makeCalendlyRequest(endpoint: string, options: AxiosRequestConfig = {}) {
  if (!CALENDLY_ACCESS_TOKEN) {
    throw new Error('CALENDLY_ACCESS_TOKEN environment variable is required');
  }

  const url = `${CALENDLY_BASE_URL}${endpoint}`;

  try {
    const response = await axios({
      url,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      data: options.data,
      params: options.params,
      ...options
    });

    return response.data;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    const statusCode = error.response?.status || 500;
    throw new Error(`Calendly API error: ${statusCode} - ${errorMessage}`);
  }
}

export async function getCurrentCalendlyUser() {
  return makeCalendlyRequest('/users/me');
}

export async function getCalendlyEventTypes(userUri: string): Promise<CalendlyEventType[]> {
  console.log("claendly user !!!: ", userUri);
  const response = await makeCalendlyRequest('/event_types', {
    params: {
      user: userUri,
      active: 'true'
    }
  });
  console.log("response: ", response);
  return response.collection || [];
}

export async function findEventTypeByName(eventName: string, userUri?: string): Promise<CalendlyEventType | null> {
  try {
    // If no userUri provided, get current user
    if (!userUri) {
      const currentUser = await getCurrentCalendlyUser();
      userUri = currentUser.resource.uri;
    }

    const eventTypes = await getCalendlyEventTypes(userUri!);

    // Find exact match first
    let eventType = eventTypes.find(et =>
      et.name.toLowerCase() === eventName.toLowerCase() && et.active
    );

    // If no exact match, find partial match
    if (!eventType) {
      eventType = eventTypes.find(et =>
        et.name.toLowerCase().includes(eventName.toLowerCase()) && et.active
      );
    }

    return eventType || null;
  } catch (error) {
    console.error('Error finding event type:', error);
    return null;
  }
}

export async function createCalendlySchedulingLink(eventTypeUri: string, maxEventCount: number = 1): Promise<CalendlySchedulingLink> {
  const payload = {
    max_event_count: maxEventCount,
    owner: eventTypeUri,
    owner_type: 'EventType'
  };

  const response = await makeCalendlyRequest('/scheduling_links', {
    method: 'POST',
    data: payload
  });

  return response.resource;
}

export async function createSingleUseLink(eventName: string, userUri?: string): Promise<string> {
  try {
    // Find the event type by name
    const eventType = await findEventTypeByName(eventName, userUri);

    if (!eventType) {
      throw new Error(`Event type '${eventName}' not found`);
    }

    // Create single-use scheduling link
    const schedulingLink = await createCalendlySchedulingLink(eventType.uri, 1);

    return schedulingLink.booking_url;
  } catch (error) {
    console.error('Error creating single-use link:', error);
    throw error;
  }
}

export async function getCalendlyUserByEmail(email: string): Promise<string | null> {
  try {
    const profile = await getCalendlyUserProfileByEmail(email);
    return profile?.uri || null;
  } catch (error) {
    console.error('Error finding user by email:', error);
    return null;
  }
}

/**
 * Get full Calendly user profile by email (server-side filtered)
 */
export async function getCalendlyUserProfileByEmail(email: string): Promise<CalendlyUserProfile | null> {
  try {
    const organizationUri = CALENDLY_ORG_URI || (await getCurrentCalendlyUser()).resource.current_organization;

    const response = await makeCalendlyRequest('/organization_memberships', {
      params: {
        organization: organizationUri,
        email,
      }
    });
    const members = response.collection || [];

    if (members.length === 0) return null;
    return members[0].user as CalendlyUserProfile;
  } catch (error) {
    console.error('Error finding user profile by email:', error);
    return null;
  }
}

/**
 * Lookup a Calendly organization member by email — returns profile + event types
 * Used by admin to auto-populate provider/doctor details from just an email
 */
export async function lookupCalendlyMemberByEmail(email: string): Promise<{
  user: CalendlyUserProfile;
  eventTypes: CalendlyEventType[];
} | null> {
  try {
    const profile = await getCalendlyUserProfileByEmail(email);
    if (!profile) return null;

    const eventTypes = await getCalendlyEventTypes(profile.uri);
    return { user: profile, eventTypes };
  } catch (error) {
    console.error('Error looking up Calendly member:', error);
    return null;
  }
}

export async function getScheduledEvents(userUri: string, filters: {
  status?: 'active' | 'canceled';
  sort?: 'start_time:asc' | 'start_time:desc';
  count?: number;
  minStartTime?: string;
  maxStartTime?: string;
  pageToken?: string;
} = {}) {
  // Clamp min_start_time: if caller didn't provide one, or provided a date
  // earlier than the launch date, use the launch date. Otherwise honor it.
  const minStartTime =
    filters.minStartTime && filters.minStartTime >= CALENDLY_LAUNCH_DATE
      ? filters.minStartTime
      : CALENDLY_LAUNCH_DATE;

  // Calendly requires the full set of filters to be repeated on every
  // paginated call — the page_token is tied to the query signature and
  // is rejected if the filters don't match the original call.
  const params: any = {
    user: userUri,
    min_start_time: minStartTime,
    ...(filters.status && { status: filters.status }),
    ...(filters.sort && { sort: filters.sort }),
    ...(filters.count && { count: filters.count.toString() }),
    ...(filters.maxStartTime && { max_start_time: filters.maxStartTime }),
    ...(filters.pageToken && { page_token: filters.pageToken }),
  };

  console.log('🔍 Calendly getScheduledEvents params:', JSON.stringify(params));

  const response = await makeCalendlyRequest('/scheduled_events', {
    params
  });

  return {
    collection: response.collection || [],
    pagination: response.pagination || {}
  };
}

export async function getScheduledEventsByInviteeEmail(inviteeEmail: string) {
  if (!CALENDLY_ORG_URI) {
    throw new Error('CALENDLY_ORG_URI environment variable is required');
  }

  const params = {
    organization: CALENDLY_ORG_URI,
    invitee_email: inviteeEmail,
    status: "active",
    min_start_time: CALENDLY_LAUNCH_DATE
  };

  const response = await makeCalendlyRequest('/scheduled_events', {
    params
  });
  console.log("response of the scheduled meetings for : ", inviteeEmail, "\n", response);
  return response.collection || [];
}

export async function getEventInvitees(eventUri: string) {
  try {
    // Extract the UUID from the event URI
    // eventUri format: https://api.calendly.com/scheduled_events/{uuid}
    const eventUuid = eventUri.split('/').pop();
    const response = await makeCalendlyRequest(`/scheduled_events/${eventUuid}/invitees`);
    return response.collection || [];
  } catch (error: any) {
    console.error(`Error fetching invitees for event ${eventUri}:`, error.message);
    return [];
  }
}

// ============================================================================
// URI-based meeting retrieval (without email)
// These functions allow tracking patient meetings using stored Calendly URIs
// ============================================================================

import type { ScheduledEventDetails, InviteeDetails } from '../types/calendly-types';

/**
 * Get scheduled event details by event URI
 * Does NOT require patient email - uses stored URI
 */
export async function getScheduledEventByUri(eventUri: string): Promise<ScheduledEventDetails | null> {
  try {
    // Extract the UUID from the event URI
    // eventUri format: https://api.calendly.com/scheduled_events/{uuid}
    const eventUuid = eventUri.split('/').pop();
    if (!eventUuid) {
      throw new Error('Invalid event URI format');
    }

    const response = await makeCalendlyRequest(`/scheduled_events/${eventUuid}`);
    return response.resource || null;
  } catch (error: any) {
    console.error(`Error fetching event by URI ${eventUri}:`, error.message);
    return null;
  }
}

/**
 * Get invitee details by invitee URI
 * Does NOT require patient email - uses stored URI
 */
export async function getInviteeByUri(inviteeUri: string): Promise<InviteeDetails | null> {
  try {
    // inviteeUri format: https://api.calendly.com/scheduled_events/{event_uuid}/invitees/{invitee_uuid}
    // We need to extract both UUIDs
    const uriParts = inviteeUri.split('/');
    const inviteeUuid = uriParts.pop();
    uriParts.pop(); // Remove 'invitees'
    const eventUuid = uriParts.pop();

    if (!eventUuid || !inviteeUuid) {
      throw new Error('Invalid invitee URI format');
    }

    const response = await makeCalendlyRequest(`/scheduled_events/${eventUuid}/invitees/${inviteeUuid}`);
    return response.resource || null;
  } catch (error: any) {
    console.error(`Error fetching invitee by URI ${inviteeUri}:`, error.message);
    return null;
  }
}

/**
 * Get complete meeting details by event URI (event + all invitees)
 * Primary method for tracking patient meetings without email
 */
export async function getMeetingDetailsByEventUri(eventUri: string): Promise<{
  event: ScheduledEventDetails | null;
  invitees: InviteeDetails[];
} | null> {
  try {
    const event = await getScheduledEventByUri(eventUri);
    if (!event) {
      return null;
    }

    const invitees = await getEventInvitees(eventUri);

    return {
      event,
      invitees
    };
  } catch (error: any) {
    console.error(`Error fetching meeting details for ${eventUri}:`, error.message);
    return null;
  }
}

/**
 * Get patient's meeting using stored Calendly URIs (no email required)
 * Falls back to email-based lookup if URIs are not available
 */
export async function getPatientMeetingByStoredUri(
  eventUri: string | null | undefined,
  inviteeUri: string | null | undefined,
  fallbackEmail?: string
): Promise<{
  event: ScheduledEventDetails | null;
  invitee: InviteeDetails | null;
  method: 'uri' | 'email' | 'none';
}> {
  // Try URI-based lookup first (preferred - no email needed)
  if (eventUri) {
    const event = await getScheduledEventByUri(eventUri);
    let invitee: InviteeDetails | null = null;

    if (inviteeUri) {
      invitee = await getInviteeByUri(inviteeUri);
    } else if (event) {
      // Get first invitee from event if invitee URI not stored
      const invitees = await getEventInvitees(eventUri);
      invitee = invitees[0] || null;
    }

    if (event) {
      return { event, invitee, method: 'uri' };
    }
  }

  // Fall back to email-based lookup
  if (fallbackEmail) {
    try {
      const events = await getScheduledEventsByInviteeEmail(fallbackEmail);
      if (events.length > 0) {
        const latestEvent = events[0]; // Already sorted by Calendly
        const invitees = await getEventInvitees(latestEvent.uri);
        return {
          event: latestEvent,
          invitee: invitees[0] || null,
          method: 'email'
        };
      }
    } catch (error) {
      console.error('Email fallback failed:', error);
    }
  }

  return { event: null, invitee: null, method: 'none' };
}