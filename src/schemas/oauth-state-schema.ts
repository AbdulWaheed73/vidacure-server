import mongoose, { Schema, Document } from "mongoose";
import { OAuthStateT } from "../types/oauth-state-type";

// Short-lived, single-use store for OIDC `state` values issued during BankID login.
// Acts as a fallback when the `oauth_state` cookie does not survive the same-device
// BankID round-trip (e.g. login started in an in-app browser, callback lands in Safari).
const OAuthStateSchema: Schema = new Schema({
  state: { type: String, required: true, unique: true },
  // TTL: abandoned login attempts auto-expire after 10 minutes.
  createdAt: { type: Date, default: Date.now, expires: 600 },
  // Set when the state is first validated. Kept (not deleted) until TTL so a duplicate
  // callback (e.g. iOS Safari firing twice) can be recognised as benign rather than
  // reported as an "Invalid state parameter".
  usedAt: { type: Date },
});

export default mongoose.model<OAuthStateT & Document>("OAuthState", OAuthStateSchema);
