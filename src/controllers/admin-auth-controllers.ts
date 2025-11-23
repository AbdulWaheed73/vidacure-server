import { Request, Response } from "express";
import { codeExchange, buildAuthorizeURL } from "@criipto/oidc";
import { ErrorResponse } from "@criipto/oidc/dist/response";
import {
  findAdminBySSN,
  createAdminJWT,
  generateAdminCSRFToken,
} from "../services/admin-auth-service";
import {
  generateRandomState,
  getAppConfig,
  getClientSecret,
  verifyCriiptoToken,
} from "../services/auth-service";
import { CriiptoUserClaims } from "../types/generic-types";
import { browserDetails } from "../middleware/auth-middleware";

/**
 * Get admin-specific redirect URI
 * Uses request headers to dynamically construct the URI (same as regular auth)
 */
function getAdminRedirectUri(req: Request): string {
  // Use request headers to build redirect URI dynamically
  if (req && req.headers && req.headers.host) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    return `${protocol}://${req.headers.host}/api/admin/auth/callback`;
  }

  // Fallback to environment variables if request headers aren't available
  const isProduction = process.env.NODE_ENV === "production";
  const baseUrl = isProduction
    ? process.env.PROD_SERVER_URL || 'http://13.62.121.217:3000'
    : process.env.DEV_SERVER_URL || 'http://localhost:3000';

  return `${baseUrl}/api/admin/auth/callback`;
}

/**
 * Initiate admin login with BankID
 * Separate from regular user login
 */
export const initiateAdminLogin = (req: Request, res: Response): void => {
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
      redirect_uri: getAdminRedirectUri(req),
      response_type: "code",
      scope: "openid profile",
      state,
      response_mode: "query",
      acr_values: acrValues,
    });

    console.log("🔐 Admin login initiated, redirect URI:", getAdminRedirectUri(req));

    res.cookie("admin_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: Number(process.env.TTL),
    });

    res.redirect(url.toString());
  } catch (error) {
    console.error("❌ Error initiating admin login:", error);
    res.status(503).json({
      error: "Admin authentication service not available",
      message: "Please configure Criipto credentials in .env file",
    });
  }
};

/**
 * Handle admin callback from BankID
 * ONLY checks Admin collection - does not check Patient or Doctor
 */
export const handleAdminCallback = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Check if auth service is initialized
    try {
      getAppConfig();
    } catch {
      res.status(503).json({
        error: "Admin authentication service not available",
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
    const storedState = req.cookies.admin_oauth_state;

    if (!state || state !== storedState) {
      console.error("❌ Invalid admin state parameter");
      const frontendUrl =
        process.env.NODE_ENV === "production"
          ? process.env.PROD_FRONTEND_URL
          : process.env.DEV_FRONTEND_URL;
      res.redirect(`${frontendUrl}/admin/login?error=invalid_state`);
      return;
    }

    // Clear state cookie
    res.clearCookie("admin_oauth_state");

    if (error) {
      console.error("❌ Admin OAuth error:", error);
      const frontendUrl =
        process.env.NODE_ENV === "production"
          ? process.env.PROD_FRONTEND_URL
          : process.env.DEV_FRONTEND_URL;
      res.redirect(`${frontendUrl}/admin/login?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      console.error("❌ No authorization code received for admin login");
      const frontendUrl =
        process.env.NODE_ENV === "production"
          ? process.env.PROD_FRONTEND_URL
          : process.env.DEV_FRONTEND_URL;
      res.redirect(`${frontendUrl}/admin/login?error=no_code`);
      return;
    }

    console.log(
      "📝 Admin authorization code received:",
      code.substring(0, 10) + "..."
    );

    // Exchange code for tokens
    const tokens:
      | { id_token: string; access_token: string }
      | ErrorResponse = await codeExchange(getAppConfig(), {
      code,
      redirect_uri: getAdminRedirectUri(req),
      client_secret: getClientSecret(),
    });

    // Check if token exchange was successful
    if ("error" in tokens) {
      console.error("❌ Admin token exchange failed:", tokens.error);
      const frontendUrl =
        process.env.NODE_ENV === "production"
          ? process.env.PROD_FRONTEND_URL
          : process.env.DEV_FRONTEND_URL;
      res.redirect(
        `${frontendUrl}/admin/login?error=token_exchange_failed`
      );
      return;
    }

    console.log("🎯 Admin token exchange successful");

    const idToken: string = tokens.id_token;

    // Verify Criipto token signature using JWKS
    let criiptoToken: CriiptoUserClaims;
    try {
      criiptoToken = await verifyCriiptoToken(idToken);
      console.log("✅ 🔐 CRIIPTO TOKEN SIGNATURE VERIFIED SUCCESSFULLY (Admin)");
      console.log("👤 Admin Criipto token claims:", criiptoToken);
    } catch (verificationError) {
      console.error("❌ Admin Criipto token verification failed:", verificationError);
      const frontendUrl =
        process.env.NODE_ENV === "production"
          ? process.env.PROD_FRONTEND_URL
          : process.env.DEV_FRONTEND_URL;
      res.redirect(
        `${frontendUrl}/admin/login?error=token_verification_failed&message=${encodeURIComponent("Token verification failed.")}`
      );
      return;
    }

    // CRITICAL: Find admin ONLY in Admin collection
    const admin = await findAdminBySSN(criiptoToken);

    if (!admin) {
      console.error("❌ Admin not found - access denied");
      const frontendUrl =
        process.env.NODE_ENV === "production"
          ? process.env.PROD_FRONTEND_URL
          : process.env.DEV_FRONTEND_URL;
      res.redirect(
        `${frontendUrl}/admin/login?error=not_admin&message=${encodeURIComponent("Access denied. Admin credentials required.")}`
      );
      return;
    }

    console.log("✅ Admin authenticated successfully:", {
      userId: admin._id?.toString(),
      name: admin.name,
      role: admin.role,
    });

    // Create admin-specific JWT
    const adminJWT = createAdminJWT(admin);

    // Generate CSRF token
    const csrfToken = generateAdminCSRFToken();

    // Store admin JWT in httpOnly cookie (separate from app_token)
    res.cookie("admin_token", adminJWT, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: Number(process.env.TTL),
    });

    // Store CSRF token for admin
    res.cookie("admin_csrf_token", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: Number(process.env.TTL),
    });

    // Redirect to admin dashboard
    const frontendUrl =
      process.env.NODE_ENV === "production"
        ? process.env.PROD_FRONTEND_URL
        : process.env.DEV_FRONTEND_URL;
    res.redirect(
      `${frontendUrl}/admin?auth=success&message=${encodeURIComponent("Admin login successful!")}`
    );
  } catch (error) {
    console.error("❌ Admin callback error:", error);

    const frontendUrl =
      process.env.NODE_ENV === "production"
        ? process.env.PROD_FRONTEND_URL
        : process.env.DEV_FRONTEND_URL;
    res.redirect(
      `${frontendUrl}/admin/login?error=authentication_failed&message=${encodeURIComponent("Admin authentication failed. Please try again.")}`
    );
  }
};

/**
 * Admin logout - clear admin tokens
 */
export const adminLogout = (_req: Request, res: Response): void => {
  res.clearCookie("admin_token");
  res.clearCookie("admin_csrf_token");

  console.log("👋 Admin logged out");

  res.json({ message: "Admin logged out successfully" });
};

/**
 * Get current admin user info
 */
export const getCurrentAdmin = (req: any, res: Response): void => {
  try {
    const adminUser = req.admin; // Set by requireAdminAuth middleware

    res.json({
      userId: adminUser.userId,
      role: adminUser.role,
      isAdmin: true,
    });
  } catch (error) {
    console.error("❌ Error getting current admin:", error);
    res.status(500).json({ error: "Failed to get admin user info" });
  }
};
