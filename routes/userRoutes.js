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
  updatePublicProfileStatus,
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
import { validate } from '../middleware/validationMiddleware.js';
import {
  adminUserIdSchema,
  adminUserListQuerySchema,
  updateIsAdminSchema,
} from '../validators/userValidator.js';

const router = express.Router();

// Authentication routes (with rate limiting)
router.post('/users/login', loginLimiter, authUser);

// User registration and listing
router
  .route('/users')
  .post(registrationLimiter, registerUser)
  .get(protect, admin, validate(adminUserListQuerySchema, 'query'), getAllUsersProfile);

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
  .delete(protect, admin, validate(adminUserIdSchema, 'params'), deleteUser);

router.patch('/users/:id/public-profile-status', protect, admin, updatePublicProfileStatus);

// Public profile view and admin update
router
  .route('/user/profile/:id')
  .get(getUserProfileById) // Public access
  .put(
    protect,
    admin,
    validate(adminUserIdSchema, 'params'),
    validate(updateIsAdminSchema),
    updateIsAdmin,
  );

export default router;
