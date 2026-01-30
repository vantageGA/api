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

import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/reviewers/admin', protect, admin, getAllUsersReviews);
router.get('/reviewer/public/:id', getAllUsersReviewers);
router.delete('/reviewer/admin/:id', protect, admin, deleteReviewer);
router.post('/users-review/login', authUserReview);
router.post('/users-review', registerUserReviewer);
router.post('/reviewer-forgot-password', reviewerForgotPassword);
router.put('/reviewer-update-password', updateReviewerPassword);

export default router;
