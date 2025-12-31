import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory path
const logsDir = path.join(__dirname, '..', 'logs');

// Configure winston logger
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'user-service' },
  transports: [
    // Write all logs to audit.log
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all error logs to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ],
});

// If we're not in production, also log to console
if (process.env.NODE_ENV !== 'production') {
  auditLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Security event types
export const SecurityEvents = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  REGISTRATION_SUCCESS: 'REGISTRATION_SUCCESS',
  REGISTRATION_FAILED: 'REGISTRATION_FAILED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  EMAIL_VERIFICATION_FAILED: 'EMAIL_VERIFICATION_FAILED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  EMAIL_CHANGE_REQUESTED: 'EMAIL_CHANGE_REQUESTED',
  EMAIL_CHANGE_VERIFIED: 'EMAIL_CHANGE_VERIFIED',
  USER_DELETED: 'USER_DELETED',
  ADMIN_STATUS_CHANGED: 'ADMIN_STATUS_CHANGED',
  UNAUTHORIZED_ACCESS_ATTEMPT: 'UNAUTHORIZED_ACCESS_ATTEMPT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
};

/**
 * Log a security event
 * @param {string} event - The event type from SecurityEvents
 * @param {string} userId - The user ID involved in the event
 * @param {object} details - Additional details about the event
 */
export const logSecurityEvent = (event, userId, details = {}) => {
  const logEntry = {
    event,
    userId: userId || 'unknown',
    timestamp: new Date().toISOString(),
    ip: details.ip || 'unknown',
    userAgent: details.userAgent || 'unknown',
    ...details
  };

  // Log at appropriate level based on event type
  if (event.includes('FAILED') || event.includes('UNAUTHORIZED')) {
    auditLogger.warn(logEntry);
  } else {
    auditLogger.info(logEntry);
  }
};

/**
 * Log an error
 * @param {string} message - Error message
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 */
export const logError = (message, error, context = {}) => {
  auditLogger.error({
    message,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    timestamp: new Date().toISOString(),
    ...context
  });
};

export default auditLogger;
