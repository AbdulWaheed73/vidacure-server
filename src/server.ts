import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import databaseConnection from "./utils/database-connection";
import { initializeAuth } from "./services/auth-service";
import authRoutes from "./routes/auth-routes";
// import adminRoutes from "./routes/admin-routes";
import patientRoutes from "./routes/patient-routes";
import doctorRoutes from "./routes/doctor-routes";
import paymentRoutes from "./routes/payment-routes";
import chatRoutes from "./routes/chat-routes";
import calendlyRoutes from "./routes/calendly-routes";
import prescriptionRoutes from "./routes/prescription-routes";
import { requireAuth, requireCSRF, requireRole } from "./middleware/auth-middleware";
import { auditMiddleware } from "./middleware/audit-middleware";
import os from 'os';


const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Environment-based configuration
const isProduction = process.env.NODE_ENV === 'production';
const FRONTEND_URL = isProduction ? process.env.PROD_FRONTEND_URL : process.env.DEV_FRONTEND_URL;
const REDIRECT_URI = isProduction ? process.env.PROD_REDIRECT_URI : process.env.DEV_REDIRECT_URI;

console.log(`🏗️ Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log(`🔗 Frontend URL: ${FRONTEND_URL}`);
console.log(`↩️ Redirect URI: ${REDIRECT_URI}`);

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
  const baseOrigins: string[] = [];

  if (FRONTEND_URL) {
    baseOrigins.push(FRONTEND_URL);
  }
  baseOrigins.push(`http://localhost:${PORT}`);

  if (!isProduction) {
    // Development: Allow localhost and common local network IPs
    return [
      ...baseOrigins,
      "http://localhost:3000",
      "http://localhost:5173",
      "http://192.168.0.101:3000",
      "http://192.168.0.103:3000",
      "http://172.16.21.144:3000",
      "http://192.168.0.101:5173",
      "http://192.168.0.103:5173",
      "http://172.16.21.144:5173",
      "http://www.vidacure.se",
      "https://vidacure.se/",
      "https://vidacure.se",
      "https://vidacure.eu/",
      "https://vidacure.eu",
    ];
  } else {
    // Production: Only allow specific origins
    return [
      ...baseOrigins,
      "http://13.62.121.217:3000",
      "http://13.62.121.217:5173",
      "http://www.vidacure.se",
      "https://vidacure.se/",
      "https://vidacure.se",
      "https://vidacure.eu/",
      "https://vidacure.eu",
    ];
  }
};

const corsOptions = {
  origin: getAllowedOrigins(),
  methods: "GET,POST,PUT,PATCH,DELETE",
  allowedHeaders: "Content-Type, Authorization, x-csrf-token, x-client",
  credentials: true,
};

app.use(cors(corsOptions));

// app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

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

// Parent Routes
app.use("/api", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/patient", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), patientRoutes);
app.use("/api/doctor", requireAuth, auditMiddleware, requireCSRF, requireRole('doctor'), doctorRoutes);
app.use("/api/prescription", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), prescriptionRoutes);
// Chat routes without CSRF for now - will add CSRF to individual routes that need it
app.use("/api/chat", requireAuth, auditMiddleware, chatRoutes);
// Calendly routes - accessible by both patients and doctors
app.use("/api/calendly", requireAuth, auditMiddleware, requireCSRF, calendlyRoutes);

app.post('/1401621/chat', express.raw({type: 'application/json'}), (req, res) => {
  console.log("\n\n\nheyy im hit !!!\n\n\n\n");
  console.log("Webhook received:", req.body);
  res.status(200).send('OK'); // Important: Send response back
});

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