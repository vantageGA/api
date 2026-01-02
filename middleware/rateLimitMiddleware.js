import rateLimit from 'express-rate-limit';
import { logSecurityEvent, SecurityEvents } from '../utils/auditLogger.js';

// Rate limiter for login attempts
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  message: {
    error: 'Too many login attempts from this IP, please try again after 15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    // Log rate limit exceeded event
    logSecurityEvent(SecurityEvents.RATE_LIMIT_EXCEEDED, req.body?.email || 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: '/login'
    });

    res.status(429).json({
      error: 'Too many login attempts from this IP, please try again after 15 minutes'
    });
  }
});

// Rate limiter for registration
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 registration requests per hour
  message: {
    error: 'Too many accounts created from this IP, please try again after an hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent(SecurityEvents.RATE_LIMIT_EXCEEDED, req.body?.email || 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: '/register'
    });

    res.status(429).json({
      error: 'Too many accounts created from this IP, please try again after an hour'
    });
  }
});

// Rate limiter for password reset requests
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  message: {
    error: 'Too many password reset requests from this IP, please try again after an hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent(SecurityEvents.RATE_LIMIT_EXCEEDED, req.body?.email || 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: '/password-reset'
    });

    res.status(429).json({
      error: 'Too many password reset requests from this IP, please try again after an hour'
    });
  }
});

// Rate limiter for review submissions
export const reviewLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 5, // Limit each reviewer to 5 reviews per day
  message: {
    error: 'Too many reviews submitted. Please try again tomorrow.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.params.id, // Rate limit by reviewer ID (from URL)
  handler: (req, res) => {
    logSecurityEvent(SecurityEvents.RATE_LIMIT_EXCEEDED, req.params.id || 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: '/reviews'
    });

    res.status(429).json({
      error: 'Too many reviews submitted. Please try again tomorrow.'
    });
  }
});

// General API rate limiter (for all routes as a safeguard)
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent(SecurityEvents.RATE_LIMIT_EXCEEDED, 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      endpoint: req.originalUrl
    });

    res.status(429).json({
      error: 'Too many requests from this IP, please try again later'
    });
  }
});
