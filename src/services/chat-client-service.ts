import axios from 'axios';
import jwt from 'jsonwebtoken';

const CHAT_SERVER_URL = process.env.CHAT_SERVER_URL || 'http://localhost:3001';
const JWT_SECRET = process.env.JWT_SECRET!;

/**
 * Generate a short-lived internal service token for server-to-server calls
 * Uses the shared JWT_SECRET so the chat server's auth middleware accepts it
 */
const generateServiceToken = (): string => {
  return jwt.sign(
    { userId: 'internal-service', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '30s' }
  );
};

/**
 * Notify the chat server to reassign a doctor for a patient's conversation.
 * Updates chat_conversations.doctorId, inserts system message,
 * and broadcasts Socket.IO events to connected clients.
 */
export const notifyChatReassignDoctor = async (
  patientId: string,
  newDoctorId: string
): Promise<void> => {
  try {
    const token = generateServiceToken();
    await axios.post(
      `${CHAT_SERVER_URL}/api/chat/reassign-doctor`,
      { patientId, newDoctorId },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'x-client': 'app',
        },
        timeout: 5000,
      }
    );
    console.log('[Chat Client] Successfully notified chat server of doctor reassignment');
  } catch (error: any) {
    // Non-fatal — the MongoDB relations are already updated
    console.error('[Chat Client] Failed to reach chat server for reassignment:', error.message);
  }
};
