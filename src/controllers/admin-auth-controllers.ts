import { Request, Response } from "express";
import Admin from "../schemas/admin-schema";
import {
  verifyPassword,
  checkAccountLockout,
  recordFailedAttempt,
  resetFailedAttempts,
  createPendingToken,
  verifyPendingToken,
  generateTotpSecret,
  verifyTotpCode,
  verifyTotpCodeRaw,
  encryptTotpSecret,
  generateBackupCodes,
  verifyBackupCode,
  createAdminJWT,
  generateAdminCSRFToken,
} from "../services/admin-auth-service";

/**
 * POST /api/admin/auth/login
 * Phase 1: Email + password verification → returns pending 2FA token
 */
export const adminLogin = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    // Find admin by email (case-insensitive)
    const admin = await Admin.findOne({
      email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    });

    if (!admin) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Check account lockout
    const lockout = checkAccountLockout(admin);
    if (lockout.locked) {
      res.status(423).json({
        error: "Account temporarily locked due to too many failed attempts",
        retryAfter: lockout.retryAfter,
      });
      return;
    }

    // Verify password
    const passwordValid = await verifyPassword(admin.passwordHash, password);
    if (!passwordValid) {
      await recordFailedAttempt(admin._id!.toString());
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Reset failed attempts on successful password verification
    await resetFailedAttempts(admin._id!.toString());

    // Create pending 2FA token
    const pendingToken = createPendingToken(admin._id!.toString());

    if (!admin.totpEnabled) {
      // First login — force 2FA setup
      res.json({ requires2FASetup: true, pendingToken });
    } else {
      // Normal login — require 2FA code
      res.json({ requires2FA: true, pendingToken });
    }
  } catch (error) {
    console.error("❌ Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

/**
 * POST /api/admin/auth/verify-2fa
 * Phase 2: Verify TOTP code or backup code → returns full admin session
 */
export const verifyAdmin2FA = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { code, pendingToken, isBackupCode } = req.body;

    if (!code || !pendingToken) {
      res.status(400).json({ error: "Code and pending token are required" });
      return;
    }

    // Verify pending token
    const pending = verifyPendingToken(pendingToken);
    if (!pending) {
      res.status(401).json({ error: "Invalid or expired session. Please log in again." });
      return;
    }

    const admin = await Admin.findById(pending.userId);
    if (!admin) {
      res.status(401).json({ error: "Admin not found" });
      return;
    }

    let valid = false;

    if (isBackupCode) {
      // Verify backup code
      if (!admin.backupCodes || admin.backupCodes.length === 0) {
        res.status(401).json({ error: "No backup codes available" });
        return;
      }
      const result = await verifyBackupCode(code, admin.backupCodes);
      valid = result.valid;
      if (valid) {
        // Remove used backup code
        admin.backupCodes = result.remainingCodes;
        await admin.save();
      }
    } else {
      // Verify TOTP code
      if (!admin.totpSecret) {
        res.status(401).json({ error: "2FA not set up" });
        return;
      }
      valid = await verifyTotpCode(admin.totpSecret, code);
    }

    if (!valid) {
      res.status(401).json({ error: "Invalid verification code" });
      return;
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Create full admin JWT
    const adminJWT = createAdminJWT(admin);
    const csrfToken = generateAdminCSRFToken();

    // Set cookies
    res.cookie("admin_token", adminJWT, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: Number(process.env.TTL),
    });

    res.cookie("admin_csrf_token", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: Number(process.env.TTL),
    });

    console.log("✅ Admin 2FA verified:", {
      userId: admin._id?.toString(),
      role: admin.role,
    });

    res.json({
      success: true,
      user: {
        userId: admin._id?.toString(),
        role: admin.role,
        isAdmin: true,
      },
    });
  } catch (error) {
    console.error("❌ Admin 2FA verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
};

/**
 * POST /api/admin/auth/setup-2fa
 * Generate TOTP secret and QR code for first-time setup
 * Does NOT save — user must confirm with a valid code first
 */
export const setupAdmin2FA = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { pendingToken } = req.body;

    if (!pendingToken) {
      res.status(400).json({ error: "Pending token is required" });
      return;
    }

    const pending = verifyPendingToken(pendingToken);
    if (!pending) {
      res.status(401).json({ error: "Invalid or expired session. Please log in again." });
      return;
    }

    const admin = await Admin.findById(pending.userId);
    if (!admin) {
      res.status(401).json({ error: "Admin not found" });
      return;
    }

    if (admin.totpEnabled) {
      res.status(400).json({ error: "2FA is already enabled" });
      return;
    }

    // Generate TOTP secret and QR code
    const { secret, qrCodeDataUrl } = await generateTotpSecret(admin.email);

    // Generate backup codes
    const { plain: backupCodes } = await generateBackupCodes();

    res.json({
      qrCodeUrl: qrCodeDataUrl,
      secret,
      backupCodes,
    });
  } catch (error) {
    console.error("❌ Admin 2FA setup error:", error);
    res.status(500).json({ error: "2FA setup failed" });
  }
};

/**
 * POST /api/admin/auth/confirm-2fa
 * Confirm TOTP setup by verifying a code, then save encrypted secret and hashed backup codes
 */
export const confirmAdmin2FA = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { pendingToken, code, secret, backupCodes } = req.body;

    if (!pendingToken || !code || !secret || !backupCodes) {
      res.status(400).json({
        error: "Pending token, code, secret, and backup codes are required",
      });
      return;
    }

    const pending = verifyPendingToken(pendingToken);
    if (!pending) {
      res.status(401).json({ error: "Invalid or expired session. Please log in again." });
      return;
    }

    const admin = await Admin.findById(pending.userId);
    if (!admin) {
      res.status(401).json({ error: "Admin not found" });
      return;
    }

    // Verify the code against the raw secret (proves user set up authenticator)
    const valid = await verifyTotpCodeRaw(secret, code);
    if (!valid) {
      res.status(401).json({ error: "Invalid code. Please scan the QR code and try again." });
      return;
    }

    // Encrypt secret and hash backup codes
    const encryptedSecret = encryptTotpSecret(secret);
    const hashedBackupCodes: string[] = [];
    const argon2 = await import("argon2");
    for (const bc of backupCodes) {
      hashedBackupCodes.push(
        await argon2.hash(bc, { type: argon2.argon2id })
      );
    }

    // Save to admin doc
    admin.totpSecret = encryptedSecret;
    admin.totpEnabled = true;
    admin.backupCodes = hashedBackupCodes;
    admin.lastLogin = new Date();
    await admin.save();

    // Create full admin JWT
    const adminJWT = createAdminJWT(admin);
    const csrfToken = generateAdminCSRFToken();

    // Set cookies
    res.cookie("admin_token", adminJWT, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: Number(process.env.TTL),
    });

    res.cookie("admin_csrf_token", csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: Number(process.env.TTL),
    });

    console.log("✅ Admin 2FA setup confirmed:", {
      userId: admin._id?.toString(),
      role: admin.role,
    });

    res.json({
      success: true,
      user: {
        userId: admin._id?.toString(),
        role: admin.role,
        isAdmin: true,
      },
    });
  } catch (error) {
    console.error("❌ Admin 2FA confirm error:", error);
    res.status(500).json({ error: "2FA confirmation failed" });
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
    const adminUser = req.admin;

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
