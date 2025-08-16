import express from "express";
import { 
  initiateLogin, 
  handleCallback, 
  getCurrentUser, 
  logout 
} from "../controllers/auth-controllers";
import { requireAuth, requireCSRF } from "../middleware/auth-middleware";

const router = express.Router();

// Authentication routes
router.get("/login", initiateLogin);
router.get("/callback", handleCallback);
router.post("/callback", handleCallback);
router.get("/me", requireAuth, requireCSRF, getCurrentUser);
router.post("/logout", logout);

export default router;
