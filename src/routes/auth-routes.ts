import express from "express";
import {
  initiateLogin,
  handleCallback,
  getCurrentUser,
  logout,
  setLogin,
} from "../controllers/auth-controllers";
import { requireAuth } from "../middleware/auth-middleware";
import { auditMiddleware } from "../middleware/audit-middleware";
import { CriiptoVerifyExpressJwt } from "@criipto/verify-express";

const expressJwt = new CriiptoVerifyExpressJwt({
  domain: process.env.CRIIPTO_DOMAIN as string, // Replace with your domain
  clientID: process.env.CRIIPTO_CLIENT_ID_APP as string, // Replace with your client ID
});

const router = express.Router();

// auth api endpoint for web 
router.get("/login", initiateLogin);
// api endpoint for mobile apps to login 
router.post("/login", expressJwt.middleware(), setLogin);

router.get("/callback", handleCallback);
router.post("/callback", handleCallback);
router.get("/me", requireAuth, auditMiddleware, getCurrentUser);
router.post("/logout", requireAuth, logout);

router.get("/login/check", requireAuth, auditMiddleware, getCurrentUser)

// Health check endpoint for network connectivity testing
router.get("/health", (_req, res) => {
  res.json({
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

export default router;
