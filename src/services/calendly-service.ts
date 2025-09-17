import axios, { AxiosRequestConfig } from 'axios';

// Environment variables
const CALENDLY_ACCESS_TOKEN: string = process.env.CALENDLY_ACCESS_TOKEN || '';
const CALENDLY_ORG_URI: string = process.env.CALENDLY_ORG_URI || '';
const CALENDLY_BASE_URL = 'https://api.calendly.com';

// Types
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
    // Get current user's organization
    const currentUser = await getCurrentCalendlyUser();
    const organizationUri = currentUser.resource.current_organization;

    // Get organization members
    const response = await makeCalendlyRequest('/organization_memberships', {
      params: {
        organization: organizationUri
      }
    });
    const members = response.collection || [];

    // Find member by email
    const member = members.find((m: any) => m.user.email === email);
    return member?.user.uri || null;
  } catch (error) {
    console.error('Error finding user by email:', error);
    return null;
  }
}

export async function getScheduledEvents(userUri: string, filters: {
  status?: 'active' | 'canceled';
  sort?: 'start_time:asc' | 'start_time:desc';
  count?: number;
  minStartTime?: string;
  maxStartTime?: string;
} = {}) {
  const params: any = {
    user: userUri,
    ...(filters.status && { status: filters.status }),
    ...(filters.sort && { sort: filters.sort }),
    ...(filters.count && { count: filters.count.toString() }),
    ...(filters.minStartTime && { min_start_time: filters.minStartTime }),
    ...(filters.maxStartTime && { max_start_time: filters.maxStartTime })
  };

  const response = await makeCalendlyRequest('/scheduled_events', {
    params
  });
  return response.collection || [];
}

export async function getScheduledEventsByInviteeEmail(inviteeEmail: string) {
  if (!CALENDLY_ORG_URI) {
    throw new Error('CALENDLY_ORG_URI environment variable is required');
  }

  const params = {
    organization: CALENDLY_ORG_URI,
    invitee_email: inviteeEmail,
    status: "active"
  };

  const response = await makeCalendlyRequest('/scheduled_events', {
    params
  });
  console.log("response of the scheduled meetings for : ", inviteeEmail, "\n", response);
  return response.collection || [];
}