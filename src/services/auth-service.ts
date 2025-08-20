import { OpenIDConfigurationManager, buildAuthorizeURL, codeExchange } from "@criipto/oidc";
import jwt, { JwtPayload } from "jsonwebtoken";
import crypto from "crypto";
import { CriiptoUserClaims, AppUserClaims, BaseUser } from "../types/generic-types";

// Environment variables
const domain: string = process.env.CRIIPTO_DOMAIN as string;
const clientId: string = process.env.CRIIPTO_CLIENT_ID as string;
const clientSecret: string = process.env.CRIIPTO_CLIENT_SECRET as string;
const redirectUri: string = process.env.REDIRECT_URI as string;
const JWT_SECRET: string = process.env.JWT_SECRET as string;
const SSN_HASH_SECRET: string = process.env.SSN_HASH_SECRET as string;

// Initialize configuration manager
const configManager = new OpenIDConfigurationManager(`https://${domain}`, clientId);
let appConfig: any;

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

export async function findOrCreateUser(criiptoToken: CriiptoUserClaims): Promise<{ user: BaseUser, isNewUser: boolean }> {
  const { ssn, name, given_name, family_name } = criiptoToken;
  
  if (!ssn || !isValidSwedishSSN(ssn)) {
    throw new Error('Invalid or missing SSN from IdP');
  }
  
  const ssnHash = hashSSN(ssn);
  
  // For now, we'll just create a user object and print it
  // You'll handle the actual database storage
  const user: BaseUser = {
    ssnHash,
    name: name || '',
    given_name: given_name || '',
    family_name: family_name || '',
    role: 'patient',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLogin: new Date()
  };
  
  // Print the user data for you to handle storage
  console.log("🔐 Authentication successful! User data received:");
  console.log("📋 User Details:", {
    ssnHash: user.ssnHash,
    name: user.name,
    given_name: user.given_name,
    family_name: user.family_name,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin
  });
  
  return { user, isNewUser: true };
}

export function createAppJWT(user: BaseUser): string {
  const payload: AppUserClaims = {
    userId: user._id?.toString() || 'temp-id',
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 60) // 30 minutes
  };
  
  return jwt.sign(payload, JWT_SECRET);
}

export function verifyAppJWT(token: string): AppUserClaims | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AppUserClaims;
  } catch (error) {
    return null;
  }
}

// Initialize the app configuration
export async function initializeAuth(): Promise<void> {
  try {
    // Check if required environment variables are set
    if (!domain || !clientId || !clientSecret) {
      console.log("⚠️ Environment variables check:");
      console.log("  CRIIPTO_DOMAIN:", domain ? "✅ Set" : "❌ Missing");
      console.log("  CRIIPTO_CLIENT_ID:", clientId ? "✅ Set" : "❌ Missing");
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
