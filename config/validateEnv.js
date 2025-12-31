/**
 * Environment Variable Validation
 *
 * Validates that all required environment variables are set
 * and meet minimum security requirements.
 *
 * Should be called at application startup before any other initialization.
 */

const requiredEnvVars = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'MAILER_HOST',
  'MAILER_USER',
  'MAILER_PW',
  'MAILER_LOCAL_URL',
  'RESET_PASSWORD_LOCAL_URL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_SECRET',
];

// MongoDB URI can be either MONGO_URI or MONGODB_URI
const mongoUriVars = ['MONGO_URI', 'MONGODB_URI'];

export const validateEnv = () => {
  console.log('Validating environment variables...');

  const missing = [];
  const warnings = [];

  // Check for missing required variables
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check for MongoDB URI (either MONGO_URI or MONGODB_URI)
  const hasMongoUri = mongoUriVars.some(varName => process.env[varName]);
  if (!hasMongoUri) {
    missing.push('MONGO_URI or MONGODB_URI');
  }

  if (missing.length > 0) {
    console.error('\n❌ FATAL ERROR: Missing required environment variables:');
    missing.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nPlease set these variables in your .env file.');
    console.error('Application cannot start without required environment variables.\n');
    process.exit(1);
  }

  // Validate JWT_SECRET strength
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      console.error('\n❌ FATAL ERROR: JWT_SECRET must be at least 16 characters in production!');
      console.error('   Current length:', jwtSecret.length);
      console.error('   Please use a strong, randomly generated secret.\n');
      process.exit(1);
    } else {
      warnings.push(`JWT_SECRET is only ${jwtSecret.length} characters. Recommended minimum: 32 characters for production security`);
    }
  } else if (jwtSecret.length < 32) {
    warnings.push(`JWT_SECRET should be at least 32 characters for optimal security (current: ${jwtSecret.length})`);
  }

  // Validate NODE_ENV
  const validNodeEnvs = ['development', 'production', 'test'];
  if (!validNodeEnvs.includes(process.env.NODE_ENV)) {
    warnings.push(`NODE_ENV should be one of: ${validNodeEnvs.join(', ')}. Current value: ${process.env.NODE_ENV}`);
  }

  // Validate MongoDB URI format
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (mongoUri && !mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    warnings.push('MongoDB URI should start with mongodb:// or mongodb+srv://');
  }

  // Validate URLs
  try {
    new URL(process.env.MAILER_LOCAL_URL);
  } catch (e) {
    warnings.push('MAILER_LOCAL_URL is not a valid URL');
  }

  try {
    new URL(process.env.RESET_PASSWORD_LOCAL_URL);
  } catch (e) {
    warnings.push('RESET_PASSWORD_LOCAL_URL is not a valid URL');
  }

  // Validate PORT is a number
  const port = parseInt(process.env.PORT);
  if (isNaN(port) || port < 1 || port > 65535) {
    warnings.push('PORT should be a number between 1 and 65535');
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Environment configuration warnings:');
    warnings.forEach(warning => {
      console.warn(`   - ${warning}`);
    });
    console.warn('');
  }

  // Success message
  if (missing.length === 0) {
    console.log('✅ All required environment variables are set');

    if (process.env.NODE_ENV === 'production') {
      console.log('🔒 Running in PRODUCTION mode');

      // Warn about common insecure secrets
      if (process.env.JWT_SECRET === 'your-secret-key' ||
          process.env.JWT_SECRET === 'secret' ||
          process.env.JWT_SECRET === 'test') {
        console.error('\n❌ FATAL ERROR: Default/insecure JWT_SECRET detected in production!');
        console.error('   Please use a strong, randomly generated secret.');
        process.exit(1);
      }
    } else {
      console.log(`🔧 Running in ${process.env.NODE_ENV.toUpperCase()} mode`);
    }

    console.log('');
  }
};

export default validateEnv;
