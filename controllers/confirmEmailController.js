import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import jwt from 'jsonwebtoken';
import { logSecurityEvent, SecurityEvents } from '../utils/auditLogger.js';
import { buildFrontendUrl } from '../utils/frontendUrl.js';

const getReviewerVerificationRedirectUrl = (status) =>
  buildFrontendUrl('/reviewer-login', { verification: status });

const logReviewerVerificationFailure = (req, reason, reviewerId = 'unknown') => {
  logSecurityEvent(SecurityEvents.EMAIL_VERIFICATION_FAILED, reviewerId, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    reason,
  });
};

// @description: Confirmation Email
// @route: GET /api/verify?token=... (legacy: /api/verify/token=:id)
// @access: public
const updateConfirmEmail = asyncHandler(async (req, res) => {
  const token = req.query.token || req.params.id;
  if (!token) {
    res.status(400);
    throw new Error('Verification token is required');
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logSecurityEvent(SecurityEvents.EMAIL_VERIFICATION_FAILED, 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Invalid or expired verification token',
    });
    res.status(401);
    throw new Error('Invalid or expired verification token');
  }

  const user = await User.findById(decodedToken.id);

  if (!user) {
    res.status(404);
    throw new Error('No user found');
  }

  user.isConfirmed = true;
  await user.save();

  logSecurityEvent(SecurityEvents.EMAIL_VERIFIED, user._id, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  return res.status(200).json({ message: 'Email verified successfully' });
});

// @description: Confirmation REVIEWER Email
// @route: GET /api/verifyReviewer?token=... (legacy: /api/verifyReviewer/token=:id)
// @access: public
const updateConfirmReviewerEmail = asyncHandler(async (req, res) => {
  const token = req.query.token || req.params.id;
  if (!token) {
    logReviewerVerificationFailure(req, 'Verification token is required');
    return res.redirect(
      303,
      getReviewerVerificationRedirectUrl('invalid'),
    );
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logReviewerVerificationFailure(req, 'Invalid or expired verification token');
    return res.redirect(
      303,
      getReviewerVerificationRedirectUrl('invalid'),
    );
  }

  if (decodedToken.type !== 'email_verification') {
    logReviewerVerificationFailure(
      req,
      'Invalid verification token type',
      decodedToken.id,
    );
    return res.redirect(
      303,
      getReviewerVerificationRedirectUrl('invalid'),
    );
  }

  const userReviewer = await UserReviewer.findById(decodedToken.id);

  if (!userReviewer) {
    logReviewerVerificationFailure(req, 'No reviewer found', decodedToken.id);
    return res.redirect(
      303,
      getReviewerVerificationRedirectUrl('invalid'),
    );
  }

  if (userReviewer.isConfirmed) {
    return res.redirect(
      303,
      getReviewerVerificationRedirectUrl('already-verified'),
    );
  }

  userReviewer.isConfirmed = true;
  await userReviewer.save();

  logSecurityEvent(SecurityEvents.EMAIL_VERIFIED, userReviewer._id, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  return res.redirect(
    303,
    getReviewerVerificationRedirectUrl('verified'),
  );
});

export {
  getReviewerVerificationRedirectUrl,
  updateConfirmEmail,
  updateConfirmReviewerEmail,
};
