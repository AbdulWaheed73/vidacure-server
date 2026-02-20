import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import databaseConnection from "./utils/database-connection";
import { validateEnvironment } from "./utils/env-validation";
import { initializeAuth } from "./services/auth-service";
import authRoutes from "./routes/auth-routes";
import patientRoutes from "./routes/patient-routes";
import doctorRoutes from "./routes/doctor-routes";
import paymentRoutes from "./routes/payment-routes";
import chatRoutes from "./routes/chat-routes";
import supabaseChatRoutes from "./routes/supabase-chat-routes";
import calendlyRoutes from "./routes/calendly-routes";
import adminRoutes from "./routes/admin-routes";
import adminAuthRoutes from "./routes/admin-auth-routes";
import prescriptionRoutes from "./routes/prescription-routes";
import labTestRoutes from "./routes/lab-test-routes";
import userDeletionRoutes from "./routes/user-deletion-routes";
import consentRoutes from "./routes/consent-routes";
import adminNotificationRoutes from "./routes/admin-notification-routes";
import pendingBookingRoutes from "./routes/pending-booking-routes";
import { requireAuth, requireCSRF, requireRole, requireActiveSubscription } from "./middleware/auth-middleware";
import { auditMiddleware } from "./middleware/audit-middleware";
import os from 'os';

// Validate environment variables before starting the server
try {
  validateEnvironment();
} catch {
  console.error('Server startup aborted due to environment validation failure');
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Environment-based configuration
const FRONTEND_URL = process.env.FRONTEND_URL;
const SERVER_URL = process.env.SERVER_URL;

console.log(`🏗️ Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔗 Frontend URL: ${FRONTEND_URL}`);
console.log(`🔗 Server URL: ${SERVER_URL}`);

databaseConnection()
  .then(() => {
    console.log("🚀 MongoDB connection established.");
  })
  .catch((err) => {
    console.error("🔥 MongoDB connection failed:", err);
    process.exit(1);
  });


// Dynamic CORS origins based on environment
const getAllowedOrigins = (): string[] => {
  const origins: string[] = [];
  if (FRONTEND_URL) origins.push(FRONTEND_URL);
  if (SERVER_URL) origins.push(SERVER_URL);
  const extra = process.env.ADDITIONAL_CORS_ORIGINS;
  if (extra) origins.push(...extra.split(',').map(o => o.trim()));
  return origins;
};

const corsOptions = {
  origin: getAllowedOrigins(),
  methods: "GET,POST,PUT,PATCH,DELETE",
  allowedHeaders: "Content-Type, Authorization, x-csrf-token, x-client",
  credentials: true,
};

app.use(cors(corsOptions));

app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// Calendly webhook needs raw body for signature verification
app.use('/api/calendly/webhook', express.raw({ type: 'application/json' }));

// Giddir lab test webhook needs raw body
app.use('/api/lab-tests/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(cookieParser());


initializeAuth()
  .then(() => {
    console.log("✅ Authentication service initialized");
  })
  .catch((err) => {
    console.warn(
      "⚠️ Authentication service failed to initialize (this is normal if .env is not configured):",
      err.message
    );
    console.log(
      "ℹ️ You can configure authentication by creating a .env file with Criipto credentials"
    );
  });

// Health check endpoint for Railway
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Parent Routes
app.use("/api", authRoutes);
app.use("/api/payment", paymentRoutes);
// Pending booking routes - mixed public and protected endpoints
app.use("/api/pending-booking", pendingBookingRoutes);
app.use("/api/patient", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), patientRoutes);
app.use("/api/doctor", requireAuth, auditMiddleware, requireCSRF, requireRole('doctor'), doctorRoutes);
app.use("/api/prescription", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), requireActiveSubscription, prescriptionRoutes);
// Chat routes without CSRF for now - will add CSRF to individual routes that need it
app.use("/api/chat", requireAuth, auditMiddleware, requireActiveSubscription, chatRoutes);
// Supabase Chat routes - new implementation
app.use("/api/supabase-chat", supabaseChatRoutes);
// Lab test routes - webhook is public (verified by secret), other routes require patient auth
app.use("/api/lab-tests", labTestRoutes);
// Calendly routes - the webhook handler inside uses express.json() and bypasses auth via route-level check
app.use("/api/calendly", calendlyRoutes);

// Admin authentication routes - separate from regular auth
app.use("/api/admin/auth", adminAuthRoutes);

// Admin panel routes - protected by admin auth middleware
app.use("/api/admin", adminRoutes);

// User deletion routes - self-deletion and admin deletion
app.use("/api/users", userDeletionRoutes);

// Consent management routes (GDPR)
app.use("/api/consent", consentRoutes);

// Admin notification routes
app.use("/api/admin/notifications", adminNotificationRoutes);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌟 Server is running on port ${PORT}`);
  
  const interfaces = os.networkInterfaces();
  console.log('\n📡 Server accessible at:');
  console.log(`   http://localhost:${PORT}`);
  
  Object.keys(interfaces).forEach((interfaceName) => {
    interfaces[interfaceName]?.forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   http://${iface.address}:${PORT} (${interfaceName})`);
      }
    });
  });
});