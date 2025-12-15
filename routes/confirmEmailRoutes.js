import express from 'express';
import { updateConfirmEmail } from '../controllers/confirmEmailController.js';
import { updateConfirmReviewerEmail } from '../controllers/confirmEmailController.js';

const router = express.Router();
// Support current query-string tokens and legacy path tokens
router.route('/verify').get(updateConfirmEmail);
router.route('/verify/token=:id').get(updateConfirmEmail);
router.route('/verifyReviewer').get(updateConfirmReviewerEmail);
router.route('/verifyReviewer/token=:id').get(updateConfirmReviewerEmail);

export default router;
