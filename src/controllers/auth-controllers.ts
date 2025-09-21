import { Request, Response } from "express";
import { AuthenticatedRequest } from "../types/generic-types";
import jwt from "jsonwebtoken";
import { codeExchange, buildAuthorizeURL } from "@criipto/oidc";
import { ErrorResponse } from "@criipto/oidc/dist/response";
import {
  findOrCreateUser,
  createAppJWT,
  generateRandomState,
  generateCSRFToken,
  getAppConfig,
  getRedirectUri,
  getClientSecret,
} from "../services/auth-service";
import { CriiptoUserClaims } from "../types/generic-types";
import Patient from "../schemas/patient-schema";
import Doctor from "../schemas/doctor-schema";

import { browserDetails } from "../middleware/auth-middleware";
import { auditDatabaseOperation, auditDatabaseError } from "../middleware/audit-middleware";

export const initiateLogin = (req: Request, res: Response): void => {
  try {
    const state = generateRandomState();
    const clientType = browserDetails(req);

    let acrValues: string;
    switch (clientType) {
      case "web":
        acrValues = "urn:grn:authn:se:bankid:same-device";
        break;
      case "mobile":
        acrValues = "urn:grn:authn:se:bankid:same-device";
        break;
      case "app":
        acrValues = "urn:grn:authn:se:bankid";
        break;
      default:
        acrValues = "urn:grn:authn:se:bankid:another-device:qr";
    }

    const url = buildAuthorizeURL(getAppConfig(), {
      redirect_uri: getRedirectUri(req),
      response_type: "code",
      scope: "openid profile",
      state,
      response_mode: "query",
      acr_values: acrValues,
    });

    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: false,
      sameSite: 'none',
      path: '/',
      maxAge: Number(process.env.TTL),
    });

    console.log("Setting oauth_state cookie:", state)

    res.redirect(url.toString());
  } catch (error) {
    console.error("❌ Error building authorize URL:", error);
    res.status(503).json({
      error: "Authentication service not available",
      message: "Please configure Criipto credentials in .env file",
    });
  }
};

export const setLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    try {
      getAppConfig();
    } catch {
      res.status(503).json({
        error: "Authentication service not available",
        message: "Please configure Criipto credentials in .env file",
      });
      return;
    }

    // Get client type from header
    const clientType = req.headers["x-client"] as string;

    if (clientType !== "app") {
      res.status(400).json({
        error: "Invalid client type",
        message: "This endpoint is for mobile applications only",
      });
      return;
    }

    // Extract the Criipto JWT from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        error: "Missing authorization header",
        message: "Bearer token required",
      });
      return;
    }

    const criiptoJWT = authHeader.substring(7);

    if (!criiptoJWT) {
      res.status(401).json({
        error: "Invalid token format",
        message: "Bearer token is empty",
      });
      return;
    }


    let criiptoUserClaims: CriiptoUserClaims;

    try {
      criiptoUserClaims = jwt.decode(criiptoJWT) as CriiptoUserClaims;

      if (!criiptoUserClaims) {
        throw new Error("Invalid token payload");
      }

      console.log("User decoded : ", criiptoUserClaims);
    } catch (verificationError) {
      console.error("❌ Criipto JWT verification failed:", verificationError);
      res.status(401).json({
        error: "Invalid token",
        message: "Failed to verify Criipto JWT",
      });
      return;
    }

    // Find or create user based on Criipto claims
    const { user, isNewUser } = await findOrCreateUser(criiptoUserClaims);
    
    // Audit log for user authentication (we'll create a special request with user info)
    const auditReq = {
      ...req,
      user: { userId: user._id?.toString() || '', role: user.role }
    } as AuthenticatedRequest;
    
    await auditDatabaseOperation(auditReq, isNewUser ? "user_registration_mobile" : "user_login_mobile", 
                               isNewUser ? "CREATE" : "READ", user._id?.toString(), 
                               { authMethod: "bankid_mobile", ssn: criiptoUserClaims.ssn ? "provided" : "missing" });

    console.log(
      `👤 ${isNewUser ? "Created new user" : "Found existing user"}:`,
      {
        userId: user._id?.toString(),
        name: user.name,
        role: user.role,
      }
    );

    // Create our app JWT for mobile client
    const appJWT = createAppJWT(user);

    console.log("✅ Mobile authentication successful");

    // Return the app JWT in response body (no cookies for mobile)
    res.json({
      success: true,
      message: isNewUser
        ? "Account created successfully"
        : "Authentication successful",
      token: appJWT,
      user: {
        userId: user._id?.toString(),
        name: user.name,
        role: user.role,
      },
      // Note: No CSRF token needed for mobile apps
    });
  } catch (error) {
    console.error("❌ Mobile login error:", error);
    
    // Try to audit the failed authentication attempt
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const criiptoJWT = authHeader.substring(7);
        const criiptoUserClaims = jwt.decode(criiptoJWT) as CriiptoUserClaims;
        
        // Create a minimal audit request for failed authentication
        const auditReq = {
          ...req,
          user: { userId: 'unknown', role: 'unknown' }
        } as any;
        
        await auditDatabaseError(auditReq, "user_login_mobile_failed", "READ", error, undefined, 
                               { authMethod: "bankid_mobile", ssn: criiptoUserClaims?.ssn ? "provided" : "missing" });
      }
    } catch {
      // Ignore audit errors during error handling
    }
    
    res.status(500).json({
      error: "Authentication failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const handleCallback = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Check if auth service is initialized
    try {
      getAppConfig();
    } catch {
      res.status(503).json({
        error: "Authentication service not available",
        message: "Please configure Criipto credentials in .env file",
      });
      return;
    }

    const code: string | undefined =
      (req.query?.code as string) || (req.body?.code as string);
    const state: string | undefined =
      (req.query?.state as string) || (req.body?.state as string);
    const error: string | undefined =
      (req.query?.error as string) || (req.body?.error as string);

    // Validate state parameter (CSRF protection)
    const storedState = req.cookies.oauth_state;
    if (!state || state !== storedState) {
      console.error("❌ Invalid state parameter");
      res.status(400).json({ error: "Invalid state parameter" });
      return;
    }

    // Clear state cookie
    res.clearCookie("oauth_state");

    if (error) {
      console.error("❌ OAuth error:", error);
      res.status(400).json({ error: "Authentication failed", details: error });
      return;
    }

    if (!code) {
      console.error("❌ No authorization code received");
      res.status(400).json({ error: "No authorization code received" });
      return;
    }

    console.log(
      "📝 Received authorization code:",
      code.substring(0, 10) + "..."
    );

    // Exchange code for tokens
    const tokens: { id_token: string; access_token: string } | ErrorResponse = await codeExchange(getAppConfig(), {
      code,
      redirect_uri: getRedirectUri(req),
      client_secret: getClientSecret(),
    });

    // Check if token exchange was successful
    if ('error' in tokens) {
      console.error("❌ Token exchange failed:", tokens.error);
      res.status(400).json({ error: "Token exchange failed", details: tokens.error });
      return;
    }

    console.log("🎯 Token exchange successful");

    const idToken: string = tokens.id_token;

    // TODO: In production, verify JWT signature with Criipto's public keys
    // For now, just decode (THIS IS NOT SECURE - IMPLEMENT VERIFICATION)
    const criiptoToken = jwt.decode(idToken) as CriiptoUserClaims;
    console.log("👤 Criipto token claims:", criiptoToken);

    // Find or create user based on SSN
    const { user, isNewUser } = await findOrCreateUser(criiptoToken);
    
    // Audit log for user authentication via web callback
    const auditReq = {
      ...req,
      user: { userId: user._id?.toString() || '', role: user.role }
    } as AuthenticatedRequest;
    
    await auditDatabaseOperation(auditReq, isNewUser ? "user_registration_web" : "user_login_web", 
                               isNewUser ? "CREATE" : "READ", user._id?.toString(), 
                               { authMethod: "bankid_web", ssn: criiptoToken.ssn ? "provided" : "missing" });

    // Create our own app JWT
    const appJWT = createAppJWT(user);

    // Generate CSRF token
    const csrfToken = generateCSRFToken();

    // Store app JWT in httpOnly cookie
    res.cookie("app_token", appJWT, {
      httpOnly: true,
      secure: Boolean(process.env.SECURE),
      sameSite: 'none',
      maxAge: Number(process.env.TTL),
    });

    // Store CSRF token in a non-httpOnly cookie so frontend can access it
    res.cookie("csrf_token", csrfToken, {
      httpOnly: false,
      secure: Boolean(process.env.SECURE),
      sameSite: 'none',
      maxAge: Number(process.env.TTL),
    });

    // Redirect back to frontend with success message
    const frontendUrl = process.env.NODE_ENV === "production" ? process.env.PROD_FRONTEND_URL : process.env.DEV_FRONTEND_URL;
    res.redirect(
      `${frontendUrl}?auth=success&message=${encodeURIComponent(isNewUser ? "Welcome! Account created successfully." : "Login successful!")}`
    );
  } catch (error) {
    console.error("❌ Callback error:", error);
    
    // Try to audit the failed authentication attempt
    try {
      const auditReq = {
        ...req,
        user: { userId: 'unknown', role: 'unknown' }
      } as any;
      
      await auditDatabaseError(auditReq, "user_login_web_callback_failed", "READ", error, undefined, 
                             { authMethod: "bankid_web", step: "callback" });
    } catch {
      // Ignore audit errors during error handling
    }
    
    res.status(500).json({
      error: "Authentication failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const getCurrentUser = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    // req.user is guaranteed to exist due to requireAuth middleware
    const userId = req.user!.userId;

    // Fetch user data from database (try Patient first, then Doctor)
    let user = await Patient.findById(userId);
    
    if (!user) {
      user = await Doctor.findById(userId);
    }

    if (!user) {
      await auditDatabaseError(req, "get_current_user", "READ", new Error("User not found"), userId);
      res.status(401).json({
        authenticated: false,
        message: "User not found",
      });
      return;
    }

    await auditDatabaseOperation(req, "get_current_user", "READ", userId, { role: user.role });

    // Get the existing CSRF token from cookie
    const existingCsrfToken = req.cookies.csrf_token;

    const userData = {
      name: user.name,
      given_name: user.given_name,
      family_name: user.family_name,
      role: user.role,
      userId: user._id?.toString(),
      lastLogin: user.lastLogin,
      hasCompletedOnboarding: user.hasCompletedOnboarding || false,
    };

    res.json({
      authenticated: true,
      message: "User is authenticated",
      user: userData,
      csrfToken: existingCsrfToken || "no-csrf-token",
    });
  } catch (error) {
    console.error("Error in getCurrentUser:", error);
    await auditDatabaseError(req, "get_current_user", "READ", error, req.user?.userId);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
};

export const logout = (_req: Request, res: Response): void => {
  try {
    res.clearCookie("app_token");
    res.clearCookie("csrf_token");
    res.json({ success: true, message: "Logged out successfully" });
  } catch {
    res.status(500).json({ error: "Failed to logout" });
  }
};
