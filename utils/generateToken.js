import jwt from 'jsonwebtoken';

// Default to 30 days but allow callers to override (e.g., shorter-lived reset links)
const generateToken = (id, expiresIn = '30d') => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn });
};

export default generateToken;
