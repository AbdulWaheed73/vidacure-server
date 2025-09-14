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
import { requireAuth, requireCSRF, requireRole } from "./middleware/auth-middleware";
import { auditMiddleware } from "./middleware/audit-middleware";
import os from 'os';


const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);


databaseConnection()
  .then(() => {
    console.log("🚀 MongoDB connection established.");
  })
  .catch((err) => {
    console.error("🔥 MongoDB connection failed:", err);
    process.exit(1);
  });


const corsOptions = {
  origin: "*", 
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type, Authorization, x-csrf-token, x-client",
  credentials: true,
};

app.use(cors(corsOptions));

app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

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
app.use("/api/payment", requireAuth,auditMiddleware, requireCSRF, requireRole('patient'), paymentRoutes);
app.use("/api/patient", requireAuth, auditMiddleware, requireCSRF, requireRole('patient'), patientRoutes);
app.use("/api/doctor", requireAuth, auditMiddleware, requireCSRF, requireRole('doctor'), doctorRoutes);
// Chat routes without CSRF for now - will add CSRF to individual routes that need it
app.use("/api/chat", requireAuth, auditMiddleware, chatRoutes);

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