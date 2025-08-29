import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import databaseConnection from "./utils/database-connection";
import { initializeAuth } from "./services/auth-service";
import authRoutes from "./routes/auth-routes";
import adminRoutes from "./routes/admin-routes";
import patientRoutes from "./routes/patient-routes";
import { requireAuth, requireCSRF } from "./middleware/auth-middleware";
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
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://192.168.0.101:3000",
    "http://192.168.0.103:3000",
    "http://172.16.21.144:3000",
    "http://192.168.0.101:5173",
    "http://192.168.0.103:5173",
    "http://172.16.21.144:5173",
    "0.0.0.0",
  ], 
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type, Authorization, x-csrf-token, x-client",
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Initialize authentication (optional - won't crash the server if it fails)
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
app.use("/patient", requireAuth, requireCSRF, patientRoutes);

// After your app.listen(), add this:
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