import { OpenIDConfigurationManager } from "@criipto/oidc";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import crypto from "crypto";
import { CriiptoUserClaims, AppUserClaims, BaseUser } from "../types/generic-types";
import Patient from "../schemas/patient-schema";
import Doctor from "../schemas/doctor-schema";
import { PatientT } from "../types/patient-type";
import { DoctorT } from "../types/doctor-type";
import { streamChatApi } from "./stream-chat-api";

// Environment variables
const domain: string = process.env.CRIIPTO_DOMAIN as string;
const clientId_web: string = process.env.CRIIPTO_CLIENT_ID_WEB as string;
const clientSecret: string = process.env.CRIIPTO_CLIENT_SECRET as string;
const redirectUri: string = process.env.REDIRECT_URI as string;
const JWT_SECRET: string = process.env.JWT_SECRET as string;
const SSN_HASH_SECRET: string = process.env.SSN_HASH_SECRET as string;
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

        console.log("✅ Updated doctor name from BankID:", {
          userId: existingDoctor._id?.toString(),
          oldName: 'Pending BankID Login',
          newName: existingDoctor.name
        });

        // Update Stream Chat profile with new name
        await streamChatApi.createStreamUser(existingDoctor);
      }

      // Update last login timestamp
      existingDoctor.lastLogin = new Date();
      await existingDoctor.save();

      console.log("🔐 Existing doctor authenticated:", {
        userId: existingDoctor._id?.toString(),
        name: existingDoctor.name,
        role: existingDoctor.role,
        lastLogin: existingDoctor.lastLogin
      });

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

        console.log("✅ Updated patient name from BankID:", {
          userId: existingPatient._id?.toString(),
          oldName: 'Pending BankID Login',
          newName: existingPatient.name
        });

        // Update Stream Chat profile with new name
        await streamChatApi.createStreamUser(existingPatient);
      }

      // Update last login timestamp
      existingPatient.lastLogin = new Date();
      await existingPatient.save();

      console.log("🔐 Existing patient authenticated:", {
        userId: existingPatient._id?.toString(),
        name: existingPatient.name,
        role: existingPatient.role,
        lastLogin: existingPatient.lastLogin
      });

      return { user: existingPatient, isNewUser: false };
    }

    // User doesn't exist, create new patient (default role)
    const newPatient = new Patient({
      ssnHash,
      name: name || `${given_name} ${family_name}`.trim() || 'Unknown User',
      given_name: given_name || '',
      family_name: family_name || '',
      role: 'patient',
      lastLogin: new Date(),
      weightHistory: [],
      questionnaire: []
    });

    const savedPatient = await newPatient.save();

    console.log("🆕 New patient created and authenticated:", {
      userId: savedPatient._id?.toString(),
      name: savedPatient.name,
      role: savedPatient.role,
      ssnHash: savedPatient.ssnHash,
      createdAt: savedPatient.createdAt
    });

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
    console.log('🔐 Verifying JWT token...');
    console.log('🔍 JWT_SECRET available:', !!JWT_SECRET);
    console.log('🔍 Token format valid:', token.split('.').length === 3);
    
    const decoded = jwt.verify(token, JWT_SECRET) as AppUserClaims;
  
    
    return decoded;
  } catch (error) {
    console.log('❌ JWT verification failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof jwt.TokenExpiredError) {
      console.log('🕒 Token is expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      console.log('🔍 Invalid token format or signature');
    }
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
