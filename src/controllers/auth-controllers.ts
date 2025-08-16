import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { codeExchange, buildAuthorizeURL } from "@criipto/oidc";
import { 
  findOrCreateUser, 
  createAppJWT, 
  generateRandomState, 
  generateCSRFToken,
  getAppConfig,
  getRedirectUri,
  getClientSecret
} from "../services/auth-service";
import { CriiptoUserClaims } from "../types/generic-types";

export const initiateLogin = (req: Request, res: Response): void => {
  try {
    const state = generateRandomState();
    
    const url = buildAuthorizeURL(getAppConfig(), {
      redirect_uri: getRedirectUri(),
      response_type: "code",
      scope: "openid profile",
      state,
      response_mode: "query"
    });
    
    // Store state for validation (in production, use proper session store)
    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      maxAge: 10 * 60 * 1000 // 10 minutes
    });
    
    console.log("🔗 Redirecting to:", url.toString());
    
    res.redirect(url.toString());
  } catch (error) {
    console.error("❌ Error building authorize URL:", error);
    res.status(503).json({ 
      error: "Authentication service not available", 
      message: "Please configure Criipto credentials in .env file" 
    });
  }
};

export const handleCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    // Check if auth service is initialized
    try {
      getAppConfig();
    } catch (authError) {
      res.status(503).json({ 
        error: "Authentication service not available", 
        message: "Please configure Criipto credentials in .env file" 
      });
      return;
    }
    
    const code: string | undefined = (req.query?.code as string) || (req.body?.code as string);
    const state: string | undefined = (req.query?.state as string) || (req.body?.state as string);
    const error: string | undefined = (req.query?.error as string) || (req.body?.error as string);
    
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
    
    console.log("📝 Received authorization code:", code.substring(0, 10) + "...");
    
    // Exchange code for tokens
    const tokens: any = await codeExchange(getAppConfig(), {
      code,
      redirect_uri: getRedirectUri(),
      client_secret: getClientSecret(),
    });
    
    console.log("🎯 Token exchange successful");
    
    const idToken: string = tokens.id_token!;
    
    // TODO: In production, verify JWT signature with Criipto's public keys
    // For now, just decode (THIS IS NOT SECURE - IMPLEMENT VERIFICATION)
    const criiptoToken = jwt.decode(idToken) as CriiptoUserClaims;
    console.log("👤 Criipto token claims:", criiptoToken);
    
    // Find or create user based on SSN
    const { user, isNewUser } = await findOrCreateUser(criiptoToken);
    
    // Create our own app JWT
    const appJWT = createAppJWT(user);
    
    // Generate CSRF token
    const csrfToken = generateCSRFToken();
    
    // Store app JWT in httpOnly cookie
    res.cookie("app_token", appJWT, { 
      httpOnly: true, 
      secure: false, // Set to true in production with HTTPS
      maxAge: 30 * 60 * 1000 // 30 minutes
    });
    
    // Return success response (no sensitive data)
    res.json({ 
      success: true, 
      message: isNewUser ? "Welcome! Account created successfully." : "Login successful!",
      user: {
        name: user.name,
        role: user.role
      },
      csrfToken // Frontend needs this for API calls
    });
    
  } catch (error) {
    console.error("❌ Callback error:", error);
    res.status(500).json({ 
      error: "Authentication failed", 
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
};

export const getCurrentUser = (req: Request, res: Response): void => {
  try {
    // This would typically get user data from the database
    // For now, just return a success message
    res.json({ 
      authenticated: true, 
      message: "User is authenticated"
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user data" });
  }
};

export const logout = (req: Request, res: Response): void => {
  try {
    res.clearCookie("app_token");
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to logout" });
  }
};
