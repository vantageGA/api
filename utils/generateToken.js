import jwt from 'jsonwebtoken';

// Default to 30 days but allow callers to override (e.g., shorter-lived reset links)
const generateToken = (id, expiresIn = '30d', type = 'auth') => {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, { expiresIn });
};

// Generate email verification token (24 hour expiry)
export const generateEmailVerificationToken = (id) => {
  return jwt.sign({ id, type: 'email_verification' }, process.env.JWT_SECRET, { expiresIn: '24h' });
};

// Generate password reset token (15 minute expiry)
export const generatePasswordResetToken = (id) => {
  return jwt.sign({ id, type: 'password_reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
};

// Generate email change token (1 hour expiry)
export const generateEmailChangeToken = (id) => {
  return jwt.sign({ id, type: 'email_change' }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

export default generateToken;
