// Set required environment variables before any module imports
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_for_testing";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.ADMIN_JWT_SECRET = "test-admin-jwt-secret";
process.env.ADMIN_2FA_ENCRYPTION_KEY = "0".repeat(64);
process.env.AUDIT_HMAC_KEY = "test-audit-hmac-key";
process.env.SSN_HMAC_SECRET = "test-ssn-hmac-secret";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.SERVER_URL = "http://localhost:3000";
process.env.MONGODB_URI = "mongodb://localhost:27017/test";
process.env.NODE_ENV = "test";
