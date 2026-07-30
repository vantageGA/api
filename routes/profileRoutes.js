import express from 'express';
import {
  getAllProfiles,
  getAllProfilesAdmin,
  getProfileReviewsAdmin,
  getProfileById,
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  createProfileReview,
  updateProfileQualificationToTrue,
  updateProfileClicks,
  getAllProfileImages,
  getAllProfileImagesPublic,
  updateOnboardingTutorialStatus,
} from '../controllers/profileController.js';
import { createProfileAIDraft } from '../controllers/profileDraftController.js';
import {
  bulkApproveReviews,
  getModerationReviews,
  moderateReview,
  amendReview,
  getReviewerReviews,
  removeReviewWithAudit,
} from '../controllers/reviewModerationController.js';

import { protect, protectReviewer, admin, requireActiveSubscription } from '../middleware/authMiddleware.js';
import { profileDraftLimiter, reviewLimiter } from '../middleware/rateLimitMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import {
  profileIdSchema,
  updateClicksSchema,
  createReviewSchema,
  updateProfileSchema,
  updateOnboardingTutorialSchema,
  profileDraftRequestSchema,
  deleteReviewSchema,
  paginationSchema,
  adminProfileListQuerySchema,
  adminProfileReviewsQuerySchema,
} from '../validators/profileValidator.js';
import {
  bulkApproveReviewsSchema,
  reviewModerationActionSchema,
  reviewModerationListSchema,
  reviewModerationParamsSchema,
  amendReviewSchema,
} from '../validators/reviewModerationValidator.js';

const router = express.Router();

// Public routes
router
  .route('/profiles')
  .get(validate(paginationSchema, 'query'), getAllProfiles)
  .post(protect, requireActiveSubscription, createProfile);

// Get all profiles ADMIN route (must be above /profiles/:id to avoid matching "admin" as an ID)
router
  .route('/profiles/admin')
  .get(
    protect,
    admin,
    validate(adminProfileListQuerySchema, 'query'),
    getAllProfilesAdmin,
  );

router
  .route('/profiles/admin/reviews')
  .get(protect, admin, validate(reviewModerationListSchema, 'query'), getModerationReviews);
router
  .route('/profiles/admin/reviews/bulk-approve')
  .post(protect, admin, validate(bulkApproveReviewsSchema), bulkApproveReviews);
router
  .route('/profiles/admin/:profileId/reviews/:reviewId/moderate')
  .patch(
    protect,
    admin,
    validate(reviewModerationParamsSchema, 'params'),
    validate(reviewModerationActionSchema),
    moderateReview,
  );

router
  .route('/profiles/:profileId/reviews/:reviewId/amend')
  .patch(
    protectReviewer,
    validate(reviewModerationParamsSchema, 'params'),
    validate(amendReviewSchema),
    amendReview,
  );
router
  .route('/reviewers/me/reviews')
  .get(protectReviewer, getReviewerReviews);

// Delete or update specific profile ADMIN routes
router
  .route('/profiles/admin/:id/reviews')
  .get(
    protect,
    admin,
    validate(profileIdSchema, 'params'),
    validate(adminProfileReviewsQuerySchema, 'query'),
    getProfileReviewsAdmin,
  );

router
  .route('/profiles/admin/:id')
  .delete(protect, admin, validate(profileIdSchema, 'params'), deleteProfile)
  .put(protect, admin, validate(profileIdSchema, 'params'), updateProfileQualificationToTrue);

router
  .route('/profiles/:id')
  .get(validate(profileIdSchema, 'params'), getProfileById);

router
  .route('/profile/ai-draft')
  .post(
    protect,
    requireActiveSubscription,
    profileDraftLimiter,
    validate(profileDraftRequestSchema),
    createProfileAIDraft,
  );

// BACKWARD COMPATIBILITY: Keep old route /profile/:id working
router
  .route('/profile/:id')
  .get(validate(profileIdSchema, 'params'), getProfileById);

router
  .route('/profiles/:id/reviews')
  .post(
    protectReviewer,
    reviewLimiter,
    validate(profileIdSchema, 'params'),
    validate(createReviewSchema),
    createProfileReview
  );

// 🔴 FRONTEND IMPACT: Route changed from PUT /api/profile/:id to PUT /api/profile
router
  .route('/profile')
  .get(protect, getProfile)
  .put(protect, requireActiveSubscription, validate(updateProfileSchema), updateProfile);
router
  .route('/profile/onboarding-tutorial')
  .patch(
    protect,
    requireActiveSubscription,
    validate(updateOnboardingTutorialSchema),
    updateOnboardingTutorialStatus,
  );

// UPDATE number of profile clicks
router.route('/profile-clicks').put(validate(updateClicksSchema), updateProfileClicks);

// Delete a single review route
// 🔴 FRONTEND IMPACT: Route changed from DELETE /profile/review/admin/:id to DELETE /profiles/:id/reviews
router
  .route('/profiles/:id/reviews')
  .delete(
    protect,
    admin,
    validate(profileIdSchema, 'params'),
    validate(deleteReviewSchema),
    removeReviewWithAudit,
  );

// GET all profile images
router.route('/profile-images').get(protect, validate(paginationSchema, 'query'), getAllProfileImages);

// GET all profile images Public
// 🔴 FRONTEND IMPACT: Route changed from /profile-images/:id to /profile-images-public/:id
router.route('/profile-images-public/:id').get(validate(profileIdSchema, 'params'), validate(paginationSchema, 'query'), getAllProfileImagesPublic);

export default router;
