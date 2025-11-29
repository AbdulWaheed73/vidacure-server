// Environment variable validation utility
export const validateRequiredEnvVars = () => {
  const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'SSN_HASH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_LIFESTYLE',
    'STRIPE_PRICE_MEDICAL',
    'CRIIPTO_DOMAIN',
    'CRIIPTO_CLIENT_SECRET',
  ];

  const environmentSpecificVars = process.env.NODE_ENV === 'production'
    ? ['PROD_FRONTEND_URL', 'PROD_REDIRECT_URI']
    : ['DEV_FRONTEND_URL', 'DEV_REDIRECT_URI'];

  const allRequiredVars = [...requiredEnvVars, ...environmentSpecificVars];
  const missingVars: string[] = [];

  allRequiredVars.forEach((varName) => {
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

// Validate Stripe price IDs format
export const validateStripePriceIds = () => {
  const lifestylePrice = process.env.STRIPE_PRICE_LIFESTYLE;
  const medicalPrice = process.env.STRIPE_PRICE_MEDICAL;

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
  const isProduction = process.env.NODE_ENV === 'production';
  const frontendUrl = isProduction ? process.env.PROD_FRONTEND_URL : process.env.DEV_FRONTEND_URL;
  const redirectUri = isProduction ? process.env.PROD_REDIRECT_URI : process.env.DEV_REDIRECT_URI;

  try {
    if (frontendUrl) {
      new URL(frontendUrl);
    }
    if (redirectUri) {
      new URL(redirectUri);
    }
  } catch {
    console.warn('⚠️  Invalid URL format detected in environment variables');
    console.warn(`   Frontend URL: ${frontendUrl}`);
    console.warn(`   Redirect URI: ${redirectUri}`);
  }
};

// Run all validations
export const validateEnvironment = () => {
  console.log('\n🔍 Validating environment configuration...\n');

  try {
    validateRequiredEnvVars();
    validateStripePriceIds();
    validateUrls();
    console.log('✅ Environment validation complete\n');
  } catch (error) {
    console.error('❌ Environment validation failed\n');
    throw error;
  }
};
