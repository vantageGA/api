import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import jwt from 'jsonwebtoken';

// Normalize redirect base (frontend origin). Falls back to '/' if not set.
const buildRedirectUrl = () => {
  const base =
    process.env.CONFIRM_REDIRECT_URL ||
    process.env.RESET_PASSWORD_LOCAL_URL ||
    '';
  const normalized = base.replace(/\/$/, '');
  return normalized ? `${normalized}/` : '/';
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

  const redirectUrl = buildRedirectUrl();
  return res.redirect(redirectUrl);
});

// @description: Confirmation REVIEWER Email
// @route: GET /api/verifyReviewer?token=... (legacy: /api/verifyReviewer/token=:id)
// @access: public
const updateConfirmReviewerEmail = asyncHandler(async (req, res) => {
  const token = req.query.token || req.params.id;
  if (!token) {
    res.status(400);
    throw new Error('Verification token is required');
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    res.status(401);
    throw new Error('Invalid or expired verification token');
  }

  const userReviewer = await UserReviewer.findById(decodedToken.id);

  if (!userReviewer) {
    res.status(404);
    throw new Error('No Reviewer found');
  }

  userReviewer.isConfirmed = true;
  await userReviewer.save();

  const redirectUrl = buildRedirectUrl();
  return res.redirect(redirectUrl);
});

export { updateConfirmEmail, updateConfirmReviewerEmail };
