import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { codeExchange, buildAuthorizeURL } from "@criipto/oidc";
import { 
  findOrCreateUser, 
  createAppJWT, 
  generateRandomState, 
  generateCSRFToken,
  verifyAppJWT,
  getAppConfig,
  getRedirectUri,
  getClientSecret,
} from "../services/auth-service";
import { CriiptoUserClaims } from "../types/generic-types";

  import { browserDetails } from "../middleware/auth-middleware";

export const initiateLogin = (req: Request, res: Response): void => {
  try {
    const state = generateRandomState();
    const clientType = browserDetails(req, res);
    console.log("Client type detected:", clientType);
    
    // Determine ACR values based on client type
    let acrValues: string;
    switch (clientType) {
      case "web":
        // Desktop web - show QR code for mobile app
        acrValues = "urn:grn:authn:se:bankid:another-device:qr";
        break;
      case "mobile":
        // Mobile browser - try to open app, fallback to QR
        acrValues = "urn:grn:authn:se:bankid:same-device";
        break;
      case "app":
        // Native mobile app - direct BankID authentication
        acrValues = "urn:grn:authn:se:bankid";
        break;
      default:
        // Fallback to web behavior
        acrValues = "urn:grn:authn:se:bankid:another-device:qr";
    }
    
    console.log("Using ACR values:", acrValues);
    
    const url = buildAuthorizeURL(getAppConfig(), {
      redirect_uri: getRedirectUri(req),
      response_type: "code",
      scope: "openid profile",
      state,
      response_mode: "query",
      acr_values: acrValues
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

export const setLogin = async (req: Request, res: Response): Promise<void> => {
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

   // Get client type from header
   const clientType = req.headers['x-client'] as string;
   
   if (clientType !== 'app') {
     res.status(400).json({ 
       error: "Invalid client type", 
       message: "This endpoint is for mobile applications only" 
     });
     return;
   }

   // Extract the Criipto JWT from Authorization header
   const authHeader = req.headers.authorization;
   
   if (!authHeader || !authHeader.startsWith('Bearer ')) {
     res.status(401).json({ 
       error: "Missing authorization header", 
       message: "Bearer token required" 
     });
     return;
   }

   const criiptoJWT = authHeader.substring(7); // Remove 'Bearer ' prefix
   
   if (!criiptoJWT) {
     res.status(401).json({ 
       error: "Invalid token format", 
       message: "Bearer token is empty" 
     });
     return;
   }

   console.log("📱 Mobile app authentication attempt");
   console.log("🎯 Received Criipto JWT:", criiptoJWT.substring(0, 10) + "...");

   // Verify the Criipto JWT using the middleware logic
   // Note: In a real implementation, you'd use the CriiptoVerifyExpressJwt middleware
   // For now, we'll decode it (YOU NEED TO IMPLEMENT PROPER VERIFICATION)
   let criiptoUserClaims: CriiptoUserClaims;
   
   try {
     // TODO: Replace this with proper Criipto JWT verification
     // const verifiedToken = await criiptoVerifyExpressJwt.verify(criiptoJWT);
     criiptoUserClaims = jwt.decode(criiptoJWT) as CriiptoUserClaims;
     
     if (!criiptoUserClaims) {
       throw new Error("Invalid token payload");
     }
     
     console.log("👤 Verified Criipto user claims:", criiptoUserClaims);
     
   } catch (verificationError) {
     console.error("❌ Criipto JWT verification failed:", verificationError);
     res.status(401).json({ 
       error: "Invalid token", 
       message: "Failed to verify Criipto JWT" 
     });
     return;
   }

   // Find or create user based on Criipto claims
   const { user, isNewUser } = await findOrCreateUser(criiptoUserClaims);
   
   console.log(`👤 ${isNewUser ? 'Created new user' : 'Found existing user'}:`, {
     userId: user._id?.toString(),
     name: user.name,
     role: user.role,
     status: user.status
   });

   // Create our app JWT for mobile client
   const appJWT = createAppJWT(user);
   
   console.log("✅ Mobile authentication successful");
   
   // Return the app JWT in response body (no cookies for mobile)
   res.json({
     success: true,
     message: isNewUser ? "Account created successfully" : "Authentication successful",
     token: appJWT,
     user: {
       userId: user._id?.toString(),
       name: user.name,
       role: user.role,
       status: user.status
     }
     // Note: No CSRF token needed for mobile apps
   });

 } catch (error) {
   console.error("❌ Mobile login error:", error);
   res.status(500).json({ 
     error: "Authentication failed", 
     details: error instanceof Error ? error.message : "Unknown error"
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
      redirect_uri: getRedirectUri(req),
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
      maxAge: 24 * 60 * 60 * 1000 // 30 minutes
    });
    
    // Store CSRF token in a non-httpOnly cookie so frontend can access it
    res.cookie("csrf_token", csrfToken, { 
      httpOnly: false, // Allow frontend to read this
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000 // 30 minutes
    });
    
    // Redirect back to frontend with success message
    const frontendUrl = process.env.FRONTEND_URL;
    res.redirect(`${frontendUrl}?auth=success&message=${encodeURIComponent(isNewUser ? 'Welcome! Account created successfully.' : 'Login successful!')}`);
    
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
    // Get user data from the JWT token in the cookie
    const appToken = req.cookies.app_token;
    
    if (!appToken) {
      res.status(401).json({ 
        authenticated: false, 
        message: "No authentication token found" 
      });
      return;
    }

    // Verify the JWT token
    const decodedToken = verifyAppJWT(appToken);
    
    if (!decodedToken) {
      res.status(401).json({ 
        authenticated: false, 
        message: "Invalid or expired token" 
      });
      return;
    }

    // Get the existing CSRF token from cookie
    const existingCsrfToken = req.cookies.csrf_token;
    
    // For now, return mock user data based on the token
    // In production, you'd fetch this from the database
    const userData = {
      name: "Authenticated User", // This should come from database
      role: decodedToken.role,
      userId: decodedToken.userId
    };

    res.json({ 
      authenticated: true, 
      message: "User is authenticated",
      user: userData,
      csrfToken: existingCsrfToken || 'no-csrf-token'
    });
  } catch (error) {
    console.error("Error in getCurrentUser:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
};

export const logout = (req: Request, res: Response): void => {
  try {
    res.clearCookie("app_token");
    res.clearCookie("csrf_token");
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to logout" });
  }
};
