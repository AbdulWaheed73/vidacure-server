import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import databaseConnection from "./utils/database-connection";
import { initializeAuth } from "./services/auth-service";
import authRoutes from "./routes/auth-routes";
import adminRoutes from "./routes/admin-routes";
import patientRoutes from "./routes/patient-routes";
import { requireAuth, requireCSRF } from "./middleware/auth-middleware";

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors());  // This will allow all origins by default

// Connect to MongoDB
databaseConnection()
  .then(() => {
    console.log("🚀 MongoDB connection established.");
  })
  .catch((err) => {
    console.error("🔥 MongoDB connection failed:", err);
    process.exit(1);
  });

  const corsOptions = {
    origin: "http://localhost:3000",  // Replace with your frontend URL (can be a list of allowed origins)
    methods: "GET,POST,PUT,DELETE",  // Specify the allowed HTTP methods
    allowedHeaders: "Content-Type, Authorization", // Allowed headers
  };
  
  app.use(cors(corsOptions));

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize authentication (optional - won't crash the server if it fails)
initializeAuth()
  .then(() => {
    console.log("✅ Authentication service initialized");
  })
  .catch((err) => {
    console.warn("⚠️ Authentication service failed to initialize (this is normal if .env is not configured):", err.message);
    console.log("ℹ️ You can configure authentication by creating a .env file with Criipto credentials");
  });

// Parent Routes
app.use("/api", authRoutes);
app.use("/api/admin", requireAuth, requireCSRF, adminRoutes);
app.use("/patient", requireAuth, requireCSRF, patientRoutes);
// app.use("/customer", customerRoutes);
// app.use("/user", userRoutes);
// app.use("/order", orderRoutes);

// Root Route
app.get("/", (req: Request, res: Response) => {
  res.send(`
    <h1>Secure Healthcare Authentication System</h1>
    <p>Available endpoints:</p>
    <ul>
      <li><a href="/api/login">🔐 Login with BankID</a></li>
      <li><a href="/api/me">👤 Check Auth Status</a></li>
      <li>
        <button onclick="logout()">🚪 Logout</button>
      </li>
    </ul>
    <p>Security features enabled: JWT verification, CSRF protection, Role-based access control</p>
    <p><strong>Note:</strong> Authentication service requires .env configuration with Criipto credentials</p>
    <script>
      async function logout() {
        const csrfToken = localStorage.getItem('csrfToken');
        await fetch('/api/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          }
        });
        localStorage.removeItem('csrfToken');
        window.location.reload();
      }
    </script>
  `);
});

// Start the server
app.listen(PORT, () => {
  console.log(`🌟 Server is running at http://localhost:${PORT}`);
});