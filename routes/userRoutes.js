import express from 'express';
import {
  authUser,
  getUserProfile,
  registerUser,
  updateUserProfile,
  getAllUsersProfile,
  getUserProfileById,
  deleteUser,
  updateIsAdmin,
  userForgotPassword,
  updateUserProfilePassword,
  verifyEmail,
  verifyEmailChange,
} from '../controllers/userController.js';

import { protect, admin } from '../middleware/authMiddleware.js';
import {
  loginLimiter,
  registrationLimiter,
  passwordResetLimiter
} from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// Authentication routes (with rate limiting)
router.post('/users/login', loginLimiter, authUser);

// User registration and listing
router
  .route('/users')
  .post(registrationLimiter, registerUser)
  .get(protect, admin, getAllUsersProfile);

// Password reset routes (with rate limiting)
router.post('/user-forgot-password', passwordResetLimiter, userForgotPassword);
router.put('/user-update-password', updateUserProfilePassword);

// Email verification routes
router.get('/verify', verifyEmail);
router.get('/verify-email-change', verifyEmailChange);

// Self profile operations
router
  .route('/users/profile')
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

// Admin-only user management by ID
router
  .route('/users/:id')
  .get(protect, admin, getUserProfileById) // FIXED: was incorrectly using getUserProfile
  .delete(protect, admin, deleteUser);

// Public profile view and admin update
router
  .route('/user/profile/:id')
  .get(getUserProfileById) // Public access
  .put(protect, admin, updateIsAdmin);

export default router;
