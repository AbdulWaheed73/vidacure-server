import express from "express";
import { requireAuth, requireRole } from "../middleware/auth-middleware";

const router = express.Router();

// Admin routes - protected by authentication and role
router.get("/users", requireAuth, requireRole('superadmin'), (req, res) => {
  try {
    // This would typically fetch users from the database
    // For now, just return a success message
    res.json({ 
      message: "Admin access granted",
      users: [] // You'll populate this with actual user data
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

export default router;
