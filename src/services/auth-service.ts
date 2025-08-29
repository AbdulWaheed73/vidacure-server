import { OpenIDConfigurationManager, buildAuthorizeURL, codeExchange } from "@criipto/oidc";
import jwt, { JwtPayload } from "jsonwebtoken";
import crypto from "crypto";
import { CriiptoUserClaims, AppUserClaims, BaseUser } from "../types/generic-types";
import User from "../schemas/user-schema";
import { UserT } from "../types/user-type";
import Patient from "../schemas/patient-schema";

// Environment variables
const domain: string = process.env.CRIIPTO_DOMAIN as string;
const clientId_web: string = process.env.CRIIPTO_CLIENT_ID_WEB as string;
const clientSecret: string = process.env.CRIIPTO_CLIENT_SECRET as string;
const redirectUri: string = process.env.REDIRECT_URI as string;
const JWT_SECRET: string = process.env.JWT_SECRET as string;
const SSN_HASH_SECRET: string = process.env.SSN_HASH_SECRET as string;

// Initialize configuration manager
const configManager = new OpenIDConfigurationManager(`https://${domain}`, clientId_web);
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

export async function findOrCreateUser(criiptoToken: CriiptoUserClaims): Promise<{ user: UserT, isNewUser: boolean }> {
  const { ssn, name, given_name, family_name } = criiptoToken;
  
  if (!ssn || !isValidSwedishSSN(ssn)) {
    throw new Error('Invalid or missing SSN from IdP');
  }
  
  const ssnHash = hashSSN(ssn);
  
  try {
    // First, try to find existing user by SSN hash
    let existingUser = await User.findOne({ ssnHash, status: 'active' });
    
    if (existingUser) {
      // Update last login timestamp
      existingUser.lastLogin = new Date();
      await existingUser.save();
      
      console.log("🔐 Existing user authenticated:", {
        userId: existingUser._id?.toString(),
        name: existingUser.name,
        role: existingUser.role,
        lastLogin: existingUser.lastLogin
      });
      
      return { user: existingUser, isNewUser: false };
    }
    
    // User doesn't exist, create new user
    const newUser = new User({
      ssnHash,
      name: name || `${given_name} ${family_name}`.trim() || 'Unknown User',
      given_name: given_name || '',
      family_name: family_name || '',
      role: 'patient',
      status: 'active',
      lastLogin: new Date()
    });
    
    const savedUser = await newUser.save();
    
    console.log("🆕 New user created and authenticated:", {
      userId: savedUser._id?.toString(),
      name: savedUser.name,
      role: savedUser.role,
      ssnHash: savedUser.ssnHash,
      createdAt: savedUser.createdAt
    });
    
    return { user: savedUser, isNewUser: true };
    
  } catch (error) {
    console.error("❌ Error in findOrCreateUser:", error);
    throw new Error(`Failed to authenticate user: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function ensurePatientProfile(user: UserT): Promise<void> {
  try {
    // Check if patient profile already exists
    const existingPatient = await Patient.findOne({ user: user._id });
    
    if (!existingPatient && user.role === 'patient') {
      console.log("📝 Creating patient profile for user:", user._id?.toString());
      
      // Create a basic patient profile
      const newPatient = new Patient({
        user: user._id,
        email: '', // This should be filled in by the patient during onboarding
        dateOfBirth: new Date(), // This should be filled in by the patient during onboarding
        gender: 'other', // This should be filled in by the patient during onboarding
        height: 0, // This should be filled in by the patient during onboarding
        weightHistory: [],
        questionnaire: []
      });
      
      await newPatient.save();
      console.log("✅ Patient profile created successfully");
    }
  } catch (error) {
    console.error("❌ Error creating patient profile:", error);
    // Don't throw error - patient profile creation is optional at this stage
  }
}

export function createAppJWT(user: UserT | BaseUser): string {
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
