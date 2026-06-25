import express from "express";
import { ingestClientError } from "../controllers/error-log-controllers";
import { createRateLimiter } from "../middleware/rate-limit-middleware";

const router = express.Router();

// Public endpoint — crashes can occur before/without auth. Defended by rate limiting
// and a small body cap; payload is validated + scrubbed in the controller.
const clientErrorLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many error reports, please slow down.",
});

router.post("/", clientErrorLimiter, express.json({ limit: "16kb" }), ingestClientError);

export default router;
