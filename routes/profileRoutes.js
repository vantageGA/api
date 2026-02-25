import express from 'express';
import {
  getAllProfiles,
  getAllProfilesAdmin,
  getProfileById,
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  createProfileReview,
  updateProfileQualificationToTrue,
  deleteReview,
  updateProfileClicks,
  getAllProfileImages,
  getAllProfileImagesPublic,
  updateOnboardingTutorialStatus,
} from '../controllers/profileController.js';

import { protect, admin } from '../middleware/authMiddleware.js';
import { reviewLimiter } from '../middleware/rateLimitMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import {
  profileIdSchema,
  updateClicksSchema,
  createReviewSchema,
  updateProfileSchema,
  updateOnboardingTutorialSchema,
  deleteReviewSchema,
  paginationSchema,
} from '../validators/profileValidator.js';

const router = express.Router();

// Public routes
router
  .route('/profiles')
  .get(validate(paginationSchema, 'query'), getAllProfiles)
  .post(protect, createProfile);

// Get all profiles ADMIN route (must be above /profiles/:id to avoid matching "admin" as an ID)
router.route('/profiles/admin').get(protect, admin, validate(paginationSchema, 'query'), getAllProfilesAdmin);

// Delete or update specific profile ADMIN routes
router
  .route('/profiles/admin/:id')
  .delete(protect, admin, validate(profileIdSchema, 'params'), deleteProfile)
  .put(protect, admin, validate(profileIdSchema, 'params'), updateProfileQualificationToTrue);

router
  .route('/profiles/:id')
  .get(validate(profileIdSchema, 'params'), getProfileById);

// BACKWARD COMPATIBILITY: Keep old route /profile/:id working
router
  .route('/profile/:id')
  .get(validate(profileIdSchema, 'params'), getProfileById);

router
  .route('/profiles/:id/reviews')
  .post(
    protect,
    reviewLimiter,
    validate(profileIdSchema, 'params'),
    validate(createReviewSchema),
    createProfileReview
  );

// 🔴 FRONTEND IMPACT: Route changed from PUT /api/profile/:id to PUT /api/profile
router.route('/profile').get(protect, getProfile).put(protect, validate(updateProfileSchema), updateProfile);
router
  .route('/profile/onboarding-tutorial')
  .patch(protect, validate(updateOnboardingTutorialSchema), updateOnboardingTutorialStatus);

// UPDATE number of profile clicks
router.route('/profile-clicks').put(validate(updateClicksSchema), updateProfileClicks);

// Delete a single review route
// 🔴 FRONTEND IMPACT: Route changed from DELETE /profile/review/admin/:id to DELETE /profiles/:id/reviews
router
  .route('/profiles/:id/reviews')
  .delete(protect, admin, validate(profileIdSchema, 'params'), validate(deleteReviewSchema), deleteReview);

// GET all profile images
router.route('/profile-images').get(protect, validate(paginationSchema, 'query'), getAllProfileImages);

// GET all profile images Public
// 🔴 FRONTEND IMPACT: Route changed from /profile-images/:id to /profile-images-public/:id
router.route('/profile-images-public/:id').get(validate(profileIdSchema, 'params'), validate(paginationSchema, 'query'), getAllProfileImagesPublic);

export default router;
