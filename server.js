import express from 'express';
import connectDB from './config/db.js';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cloudinary from 'cloudinary';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';

import contactFormRoutes from './routes/contactFormRoutes.js';
import userRoutes from './routes/userRoutes.js';
import confirmEmailRoutes from './routes/confirmEmailRoutes.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import imageUploadRoutes from './routes/imageUploadRoutes.js';
import profileImageRoutes from './routes/profileImageRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import userReviewRoutes from './routes/userReviewRoutes.js';
import { apiLimiter } from './middleware/rateLimitMiddleware.js';
import { validateEnv } from './config/validateEnv.js';
import { initEmailTransporter } from './utils/emailService.js';

// Load environment variables
dotenv.config();

// Validate environment variables before starting the server
validateEnv();

// Configure Cloudinary once at startup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

// Connect to database
connectDB();

// Initialize email transporter
initEmailTransporter();

const app = express();

// Security middleware - must be early in the middleware stack
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
// CORS: allow configured frontend origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.RESET_PASSWORD_LOCAL_URL,
  process.env.MAILER_LOCAL_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow same-origin / curl
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Limit payload size to prevent large payload attacks
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Prevent NoSQL injection by sanitizing user input
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`⚠️  Sanitized NoSQL injection attempt: ${key} in ${req.originalUrl}`);
  }
}));

// Apply general rate limiting to all routes
app.use('/api', apiLimiter);

//Routes
app.use('/api', confirmEmailRoutes);
app.use('/api', contactFormRoutes);
app.use('/api', userRoutes);

// Profiles Routes
app.use('/api', profileRoutes);
// User Review routes
app.use('/api', userReviewRoutes);
// User Profile Image upload route
app.use('/api', imageUploadRoutes);
// Profile image upload route
app.use('/api/profileUpload', profileImageRoutes);

//create static folder
const __dirname = path.resolve();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'BodyVantage API is running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Only serve frontend if client build exists (for local monorepo deployment)
if (process.env.SERVE_FRONTEND === 'true') {
  const clientBuildPath = path.join(__dirname, 'client', 'dist');
  app.use(express.static(clientBuildPath));

  app.get('*', (req, res) =>
    res.sendFile(path.resolve(clientBuildPath, 'index.html')),
  );
}

// @Error handling middleware
app.use(notFound);
app.use(errorHandler);
// @Error handling middleware

const PORT = process.env.PORT || 5000;
const MODE = process.env.NODE_ENV || 'development';

app.listen(
  PORT,
  console.log(
    `Server is running on port ${PORT} and you are running in ${MODE}`,
  ),
);
