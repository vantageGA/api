import express from 'express';
import {
  authUserReview,
  registerUserReviewer,
  getAllUsersReviews,
  getAllUsersReviewers,
  deleteReviewer,
  reviewerForgotPassword,
  updateReviewerPassword,
} from '../controllers/userReviewsController.js';

import { protect, protectReviewer, admin } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import {
  adminReviewerListQuerySchema,
  reviewerIdSchema,
} from '../validators/userReviewerValidator.js';

const router = express.Router();

router.get(
  '/reviewers/admin',
  protect,
  admin,
  validate(adminReviewerListQuerySchema, 'query'),
  getAllUsersReviews,
);
router.get('/reviewers/me', protectReviewer, getAllUsersReviewers);
router.delete(
  '/reviewer/admin/:id',
  protect,
  admin,
  validate(reviewerIdSchema, 'params'),
  deleteReviewer,
);
router.post('/users-review/login', authUserReview);
router.post('/users-review', registerUserReviewer);
router.post('/reviewer-forgot-password', reviewerForgotPassword);
router.put('/reviewer-update-password', updateReviewerPassword);

export default router;
