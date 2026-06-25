export type OAuthStateT = {
  state: string;
  createdAt: Date;
  usedAt?: Date;
};

// Result of validating an issued OIDC `state` against the server-side store:
// - "fresh":     issued and not used before — this call consumed it (valid login)
// - "duplicate": issued but already consumed by an earlier callback (benign double-hit)
// - "invalid":   never issued (or already TTL-expired) — reject
// - "error":     store lookup failed — caller should fall back to the cookie check
export type OAuthStateResult = "fresh" | "duplicate" | "invalid" | "error";
