import express from "express";
import {
  initiateLogin,
  handleCallback,
  getCurrentUser,
  logout,
  setLogin,
} from "../controllers/auth-controllers";
import { requireAuth, requireCSRF } from "../middleware/auth-middleware";
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
router.get("/me", requireAuth, requireCSRF, getCurrentUser);
router.post("/logout", logout);

router.get("/login/check",requireAuth, () => {
  console.log("object::::");
} )

export default router;
