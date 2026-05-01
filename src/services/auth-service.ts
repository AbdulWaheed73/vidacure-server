import { OpenIDConfigurationManager } from "@criipto/oidc";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import crypto from "crypto";
import { CriiptoUserClaims, AppUserClaims, BaseUser } from "../types/generic-types";
import Patient from "../schemas/patient-schema";
import Doctor from "../schemas/doctor-schema";
import { PatientT } from "../types/patient-type";
import { DoctorT } from "../types/doctor-type";

// Environment variables
const domain: string = process.env.CRIIPTO_DOMAIN as string;
const clientId_web: string = process.env.CRIIPTO_CLIENT_ID_WEB as string;
const clientSecret: string = process.env.CRIIPTO_CLIENT_SECRET as string;
const redirectUri: string = process.env.REDIRECT_URI as string;
const JWT_SECRET: string = process.env.JWT_SECRET as string;
const SSN_HASH_SECRET: string = process.env.SSN_HASH_SECRET as string;
const SSN_ENCRYPTION_KEY: string = process.env.SSN_ENCRYPTION_KEY as string;
const TTL: number = Number(process.env.TTL); // Default to 30 minutes in milliseconds

// Initialize configuration manager
const configManager = new OpenIDConfigurationManager(`https://${domain}`, clientId_web);
let appConfig: any;

// Initialize JWKS client for Criipto token verification
const jwksClientInstance = jwksClient({
  jwksUri: `https://${domain}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10
});

// Utility functions
export function hashSSN(ssn: string): string {
  return crypto.createHmac('sha256', SSN_HASH_SECRET)
    .update(ssn)
    .digest('hex');
}

export function encryptSSN(ssn: string): string {
  const key = Buffer.from(SSN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(ssn, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSSN(encrypted: string): string {
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
  const key = Buffer.from(SSN_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function isValidSwedishSSN(ssn: string): boolean {
  // Basic validation for Swedish SSN format: YYYYMMDDXXXX
  if (!/^\d{12}$/.test(ssn)) return false;
  
  // Additional validation logic can be added here
  // For now, just checking format
  return true;
}

export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateRandomState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Verifies a Criipto JWT token by validating its signature using Criipto's JWKS
 * @param token - The JWT token from Criipto to verify
 * @returns The decoded and verified token claims
 * @throws Error if token is invalid, expired, or verification fails
 */
export async function verifyCriiptoToken(token: string): Promise<CriiptoUserClaims> {
  return new Promise((resolve, reject) => {
    // First decode the token to get the header (without verification)
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || typeof decoded === 'string') {
      return reject(new Error('Invalid token format'));
    }

    const kid = decoded.header.kid;

    if (!kid) {
      return reject(new Error('Token missing key ID (kid) in header'));
    }

    // Get the signing key from JWKS
    jwksClientInstance.getSigningKey(kid, (err, key) => {
      if (err) {
        console.error('❌ Failed to get signing key from JWKS:', err);
        return reject(new Error('Failed to verify token signature'));
      }

      const signingKey = key?.getPublicKey();

      if (!signingKey) {
        return reject(new Error('Failed to retrieve public key'));
      }

      // Verify the token with the public key
      jwt.verify(
        token,
        signingKey,
        {
          algorithms: ['RS256'], // Criipto uses RS256
          issuer: `https://${domain}`, // Validate issuer matches Criipto domain
          // Note: We don't validate audience here because tokens can come from both web and app clients
          // The signature verification and issuer check provide sufficient security
        },
        (verifyErr: jwt.VerifyErrors | null, verifiedToken: string | jwt.JwtPayload | undefined) => {
          if (verifyErr) {
            console.error('❌ Token verification failed:', verifyErr.message);
            return reject(new Error(`Token verification failed: ${verifyErr.message}`));
          }

          if (!verifiedToken || typeof verifiedToken === 'string') {
            return reject(new Error('Invalid token payload'));
          }

          console.log('✅ Criipto token verified successfully');
          resolve(verifiedToken as CriiptoUserClaims);
        }
      );
    });
  });
}

/**
 * Find existing user by SSN hash - does NOT create new users
 * Used by mobile app (patient portal model)
 * @returns user if found, null if not found
 */
export async function findUserOnly(criiptoToken: CriiptoUserClaims): Promise<{ user: PatientT | DoctorT | null, error?: 'USER_NOT_FOUND' | 'ONBOARDING_REQUIRED' }> {
  const { ssn, name, given_name, family_name } = criiptoToken;

  if (!ssn || !isValidSwedishSSN(ssn)) {
    throw new Error('Invalid or missing SSN from IdP');
  }

  const ssnHash = hashSSN(ssn);

  try {
    // First, try to find existing doctor by SSN hash
    const existingDoctor = await Doctor.findOne({ ssnHash });

    if (existingDoctor) {
      // Check if doctor has placeholder names from admin creation
      const hasPlaceholderName =
        existingDoctor.name === 'Pending BankID Login' ||
        existingDoctor.given_name === 'Pending' ||
        existingDoctor.family_name === 'BankID';

      // Update names if placeholders exist and BankID provides data
      if (hasPlaceholderName && (name || given_name || family_name)) {
        existingDoctor.name = name || `${given_name} ${family_name}`.trim();
        existingDoctor.given_name = given_name || '';
        existingDoctor.family_name = family_name || '';

      }

      // Backfill encrypted SSN if missing
      if (!existingDoctor.encryptedSsn) {
        existingDoctor.encryptedSsn = encryptSSN(ssn);
      }

      // Update last login timestamp
      existingDoctor.lastLogin = new Date();
      await existingDoctor.save();

      return { user: existingDoctor };
    }

    // Second, try to find existing patient by SSN hash
    const existingPatient = await Patient.findOne({ ssnHash });

    if (existingPatient) {
      // Check if patient has completed onboarding
      if (!existingPatient.hasCompletedOnboarding) {
        return { user: null, error: 'ONBOARDING_REQUIRED' };
      }

      // Check if patient has placeholder names
      const hasPlaceholderName =
        existingPatient.name === 'Pending BankID Login' ||
        existingPatient.given_name === 'Pending' ||
        existingPatient.family_name === 'BankID';

      // Update names if placeholders exist and BankID provides data
      if (hasPlaceholderName && (name || given_name || family_name)) {
        existingPatient.name = name || `${given_name} ${family_name}`.trim();
        existingPatient.given_name = given_name || '';
        existingPatient.family_name = family_name || '';
      }

      // Backfill encrypted SSN if missing
      if (!existingPatient.encryptedSsn) {
        existingPatient.encryptedSsn = encryptSSN(ssn);
      }

      // Update last login timestamp
      existingPatient.lastLogin = new Date();
      await existingPatient.save();

      return { user: existingPatient };
    }

    // User doesn't exist - return error (don't create)
    return { user: null, error: 'USER_NOT_FOUND' };

  } catch (error) {
    console.error("❌ Error in findUserOnly:", error);
    throw new Error(`Failed to find user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function findOrCreateUser(criiptoToken: CriiptoUserClaims): Promise<{ user: PatientT | DoctorT, isNewUser: boolean }> {
  const { ssn, name, given_name, family_name } = criiptoToken;

  if (!ssn || !isValidSwedishSSN(ssn)) {
    throw new Error('Invalid or missing SSN from IdP');
  }

  const ssnHash = hashSSN(ssn);

  try {
    // First, try to find existing doctor by SSN hash
    const existingDoctor = await Doctor.findOne({ ssnHash });

    if (existingDoctor) {
      // Check if doctor has placeholder names from admin creation
      const hasPlaceholderName =
        existingDoctor.name === 'Pending BankID Login' ||
        existingDoctor.given_name === 'Pending' ||
        existingDoctor.family_name === 'BankID';

      // Update names if placeholders exist and BankID provides data
      if (hasPlaceholderName && (name || given_name || family_name)) {
        existingDoctor.name = name || `${given_name} ${family_name}`.trim();
        existingDoctor.given_name = given_name || '';
        existingDoctor.family_name = family_name || '';
      }

      // Backfill encrypted SSN if missing
      if (!existingDoctor.encryptedSsn) {
        existingDoctor.encryptedSsn = encryptSSN(ssn);
      }

      // Update last login timestamp
      existingDoctor.lastLogin = new Date();
      await existingDoctor.save();

      return { user: existingDoctor, isNewUser: false };
    }

    // Second, try to find existing patient by SSN hash
    const existingPatient = await Patient.findOne({ ssnHash });

    if (existingPatient) {
      // Check if patient has placeholder names (for consistency with doctor logic)
      const hasPlaceholderName =
        existingPatient.name === 'Pending BankID Login' ||
        existingPatient.given_name === 'Pending' ||
        existingPatient.family_name === 'BankID';

      // Update names if placeholders exist and BankID provides data
      if (hasPlaceholderName && (name || given_name || family_name)) {
        existingPatient.name = name || `${given_name} ${family_name}`.trim();
        existingPatient.given_name = given_name || '';
        existingPatient.family_name = family_name || '';
      }

      // Backfill encrypted SSN if missing
      if (!existingPatient.encryptedSsn) {
        existingPatient.encryptedSsn = encryptSSN(ssn);
      }

      // Update last login timestamp
      existingPatient.lastLogin = new Date();
      await existingPatient.save();

      return { user: existingPatient, isNewUser: false };
    }

    // User doesn't exist, create new patient (default role)
    const newPatient = new Patient({
      ssnHash,
      encryptedSsn: encryptSSN(ssn),
      name: name || `${given_name} ${family_name}`.trim() || 'Unknown User',
      given_name: given_name || '',
      family_name: family_name || '',
      role: 'patient',
      lastLogin: new Date(),
      weightHistory: [],
      questionnaire: []
    });

    const savedPatient = await newPatient.save();

    return { user: savedPatient, isNewUser: true };

  } catch (error) {
    console.error("❌ Error in findOrCreateUser:", error);
    throw new Error(`Failed to authenticate user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ensurePatientProfile function removed - patients are created directly now

export function createAppJWT(user: PatientT | DoctorT | BaseUser): string {
  const payload: AppUserClaims = {
    userId: user._id?.toString() || 'temp-id',
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + Math.floor(TTL / 1000) // Convert milliseconds to seconds
  };

  return jwt.sign(payload, JWT_SECRET);
}

export function verifyAppJWT(token: string): AppUserClaims | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AppUserClaims;
    return decoded;
  } catch {
    return null;
  }
}

// Initialize the app configuration
export async function initializeAuth(): Promise<void> {
  try {
    // Check if required environment variables are set
    if (!domain || !clientId_web || !clientSecret) {
      console.log("⚠️ Environment variables check:");
      console.log("  CRIIPTO_DOMAIN:", domain ? "✅ Set" : "❌ Missing");
      console.log("  CRIIPTO_CLIENT_ID:", clientId_web ? "✅ Set" : "❌ Missing");
      console.log("  CRIIPTO_CLIENT_SECRET:", clientSecret ? "✅ Set" : "❌ Missing");
      throw new Error("Missing required Criipto environment variables");
    }
    
    // Initialize Criipto config
    appConfig = await configManager.fetch();
    console.log("✅ Criipto configuration loaded successfully");
  } catch (error) {
    console.error("❌ Failed to initialize auth:", error);
    throw error;
  }
}

export function getAppConfig() {
  if (!appConfig) {
    throw new Error("Authentication service not initialized. Please check your .env configuration.");
  }
  return appConfig;
}

export function getRedirectUri(req?: any) {
  // If we have a request object, use the request's host
  if (req && req.headers && req.headers.host) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    return `${protocol}://${req.headers.host}/api/callback`;
  }
  
  // Fallback to environment variable
  return redirectUri;
}

export function getClientSecret() {
  return clientSecret;
}
