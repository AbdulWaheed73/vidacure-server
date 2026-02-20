// Environment variable validation utility
export const validateRequiredEnvVars = () => {
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'SSN_HASH_SECRET',
    'CRIIPTO_DOMAIN',
    'CRIIPTO_CLIENT_SECRET',
    'CRIIPTO_CLIENT_ID_WEB',
    'FRONTEND_URL',
    'SERVER_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
  ];

  const missingVars: string[] = [];

  requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach((varName) => {
      console.error(`   - ${varName}`);
    });
    console.error('\n💡 Please check your .env file and ensure all required variables are set.');
    console.error('   See .env.example for reference.\n');
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  console.log('✅ All required environment variables are set');
};

// Validate Stripe price IDs format (optional - Stripe is deprecated in favor of Chargebee)
export const validateStripePriceIds = () => {
  const lifestylePrice = process.env.STRIPE_PRICE_LIFESTYLE;
  const medicalPrice = process.env.STRIPE_PRICE_MEDICAL;

  if (!lifestylePrice && !medicalPrice) {
    console.log('ℹ️  Stripe price IDs not configured (optional - using Chargebee)');
    return;
  }

  const priceIdRegex = /^price_[a-zA-Z0-9]+$/;

  if (lifestylePrice && !priceIdRegex.test(lifestylePrice)) {
    console.warn(`⚠️  STRIPE_PRICE_LIFESTYLE appears to be invalid: ${lifestylePrice}`);
    console.warn('   Expected format: price_xxxxxxxxxxxxx');
  }

  if (medicalPrice && !priceIdRegex.test(medicalPrice)) {
    console.warn(`⚠️  STRIPE_PRICE_MEDICAL appears to be invalid: ${medicalPrice}`);
    console.warn('   Expected format: price_xxxxxxxxxxxxx');
  }
};

// Validate URLs
export const validateUrls = () => {
  const frontendUrl = process.env.FRONTEND_URL;
  const serverUrl = process.env.SERVER_URL;

  try {
    if (frontendUrl) {
      new URL(frontendUrl);
    }
    if (serverUrl) {
      new URL(serverUrl);
    }
  } catch {
    console.warn('⚠️  Invalid URL format detected in environment variables');
    console.warn(`   Frontend URL: ${frontendUrl}`);
    console.warn(`   Server URL: ${serverUrl}`);
  }
};

// Validate Giddir configuration (optional - warn but don't fail)
export const validateGiddirConfig = () => {
  const giddirVars = [
    'GIDDIR_BASE_URL',
    'GIDDIR_USERNAME',
    'GIDDIR_PASSWORD',
    'GIDDIR_APP_ID',
    'GIDDIR_PRACTITIONER_EMAIL',
  ];

  const missingVars = giddirVars.filter((v) => !process.env[v]);

  if (missingVars.length === giddirVars.length) {
    console.log('ℹ️  Giddir lab testing not configured (optional)');
    return;
  }

  if (missingVars.length > 0) {
    console.warn('⚠️  Giddir partially configured. Missing:');
    missingVars.forEach((v) => console.warn(`   - ${v}`));
  } else {
    console.log('✅ Giddir lab testing configuration found');
  }

  if (!process.env.GIDDIR_WEBHOOK_API_KEY) {
    console.warn('⚠️  GIDDIR_WEBHOOK_API_KEY not set — webhook x-api-key verification disabled');
  }
};

// Run all validations
export const validateEnvironment = () => {
  console.log('\n🔍 Validating environment configuration...\n');

  try {
    validateRequiredEnvVars();
    validateStripePriceIds();
    validateUrls();
    validateGiddirConfig();
    console.log('✅ Environment validation complete\n');
  } catch (error) {
    console.error('❌ Environment validation failed\n');
    throw error;
  }
};
