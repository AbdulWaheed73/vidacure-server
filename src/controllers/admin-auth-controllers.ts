import { Request, Response } from "express";
import Admin from "../schemas/admin-schema";
import { logAuditEvent } from "../services/audit-service";
import {
  verifyPassword,
  hashPassword,
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
  consumeBackupCodeHash,
  createAdminJWT,
  generateAdminCSRFToken,
} from "../services/admin-auth-service";

// Dummy argon2id hash used to equalize timing on the unknown-email path.
// Computed lazily on first use so we don't pay the cost at import time.
let dummyArgon2HashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyArgon2HashPromise) {
    dummyArgon2HashPromise = hashPassword("dummy-password-do-not-use");
  }
  return dummyArgon2HashPromise;
}

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

    // Reject non-string inputs early (defense against operator injection like
    // `email: { $ne: null }` matching the first admin).
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Email and password must be strings" });
      return;
    }

    // Find admin by email (case-insensitive)
    const admin = await Admin.findOne({
      email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    });

    if (!admin) {
      // Run a dummy argon2 verification against a synthetic hash so the response
      // time matches the password-check path. Without this, attackers can
      // distinguish valid-vs-invalid emails by timing (~300ms argon2 cost).
      const dummy = await getDummyHash();
      await verifyPassword(dummy, password).catch(() => false);
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
      await logAuditEvent({
        userId: admin._id!.toString(), role: 'admin', action: 'admin_login_failed',
        operation: 'READ', success: false, ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        metadata: { reason: 'invalid_password' },
      });
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Reset failed attempts on successful password verification
    await resetFailedAttempts(admin._id!.toString());

    await logAuditEvent({
      userId: admin._id!.toString(), role: 'admin', action: 'admin_login_password_verified',
      operation: 'READ', success: true, ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

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
      if (result.valid && result.matchedHash) {
        // Atomically consume the matched hash. If two concurrent requests both
        // verified the same code, only one $pull will succeed.
        valid = await consumeBackupCodeHash(admin._id!.toString(), result.matchedHash);
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
      // Count failed 2FA attempts so an attacker who has the password can't
      // brute-force unlimited 6-digit TOTP codes within the 5-min pending token.
      await recordFailedAttempt(admin._id!.toString());
      await logAuditEvent({
        userId: admin._id!.toString(), role: 'admin', action: 'admin_2fa_failed',
        operation: 'READ', success: false, ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        metadata: { method: isBackupCode ? 'backup_code' : 'totp' },
      });
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

    await logAuditEvent({
      userId: admin._id!.toString(), role: 'admin', action: 'admin_login_success',
      operation: 'READ', success: true, ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
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

    await logAuditEvent({
      userId: admin._id!.toString(), role: 'admin', action: 'admin_2fa_setup_confirmed',
      operation: 'CREATE', success: true, ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
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
    res.status(500).json({ error: "2FA confirmation failed" });
  }
};

/**
 * Admin logout - clear admin tokens
 */
export const adminLogout = async (req: any, res: Response): Promise<void> => {
  const adminId = req.admin?.userId;
  res.clearCookie("admin_token");
  res.clearCookie("admin_csrf_token");

  if (adminId) {
    await logAuditEvent({
      userId: adminId, role: 'admin', action: 'admin_logout',
      operation: 'DELETE', success: true, ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });
  }

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
