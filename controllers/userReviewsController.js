import asyncHandler from 'express-async-handler';
import generateToken, {
  generateEmailVerificationToken,
  generatePasswordResetToken,
} from '../utils/generateToken.js';
import UserReviewer from '../models/userReviewerModel.js';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Profile from '../models/profileModel.js';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/userValidator.js';
import {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} from '../services/emailService.js';
import { logSecurityEvent, SecurityEvents, logError } from '../utils/auditLogger.js';
import {
  serializeReviewer,
  serializeReviewers,
} from '../utils/userReviewerSerializer.js';

const escapeRegex = (value = '') =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @description: Get All the user REVIEWS
// @route: GET /api/reviewers/admin
// @access: Admin
const getAllUsersReviews = asyncHandler(async (req, res) => {
  const { page, limit, search, isConfirmed, hasSubmittedReview } = req.query;
  const skip = (page - 1) * limit;
  const filter = {};

  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { name: new RegExp(safeSearch, 'i') },
      { email: new RegExp(safeSearch, 'i') },
    ];
  }
  if (isConfirmed !== undefined) filter.isConfirmed = isConfirmed;
  if (hasSubmittedReview !== undefined) {
    filter.hasSubmittedReview = hasSubmittedReview;
  }

  const [reviewers, total] = await Promise.all([
    UserReviewer.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserReviewer.countDocuments(filter),
  ]);

  res.json({
    reviewers: serializeReviewers(reviewers),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

// @description: Get the authenticated reviewer's safe account details
// @route: GET /api/reviewers/me
// @access: Reviewer
const getAllUsersReviewers = asyncHandler(async (req, res) => {
  res.json(serializeReviewer(req.reviewer));
});

// @description: Delete a single reviewer
// @route: DELETE /api/reviewer/admin/:id
// @access: PRIVATE/Admin
const deleteReviewer = asyncHandler(async (req, res) => {
  const reviewer = await UserReviewer.findOneAndUpdate(
    {
      _id: req.params.id,
      deletionPending: { $ne: true },
    },
    { $set: { deletionPending: true } },
    { new: true },
  ).select('+deletionPending');

  if (reviewer) {
    const session = await mongoose.startSession();
    let anonymisedReviews;

    try {
      await session.withTransaction(async () => {
        anonymisedReviews = await Profile.updateMany(
          { 'reviews.user': reviewer._id },
          {
            $set: {
              'reviews.$[review].user': null,
              'reviews.$[review].name': 'Deleted reviewer',
              'reviews.$[review].showName': false,
              'reviews.$[review].userProfileId': null,
            },
          },
          {
            arrayFilters: [{ 'review.user': reviewer._id }],
            session,
          },
        );

        await UserReviewer.deleteOne({ _id: reviewer._id }, { session });
      });
    } catch (error) {
      await UserReviewer.updateOne(
        { _id: reviewer._id },
        { $set: { deletionPending: false } },
      );
      throw error;
    } finally {
      await session.endSession();
    }

    logSecurityEvent(SecurityEvents.REVIEWER_DELETED, reviewer._id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      deletedBy: req.user._id,
      matchedProfiles: anonymisedReviews.matchedCount || 0,
      modifiedProfiles: anonymisedReviews.modifiedCount || 0,
    });
    res.json({
      message: 'Reviewer successfully removed',
      anonymisedProfiles: anonymisedReviews.modifiedCount || 0,
    });
  } else {
    const reviewerExists = await UserReviewer.exists({ _id: req.params.id });
    if (reviewerExists) {
      res.status(409);
      throw new Error('Reviewer deletion is already in progress');
    }

    res.status(404);
    throw new Error('Reviewer Not Found');
  }
});

// @description: Authenticate a user for a REVIEW and get a token
// @route: POST /api/user-reviews/login
// @access: Public
const authUserReview = asyncHandler(async (req, res) => {
  const { email, password, userProfileId } = req.body;
  const user = await UserReviewer.findOne({
    email,
    deletionPending: { $ne: true },
  }).select('+password');
  if (user && (await user.matchPassword(password))) {
    if (!user.isConfirmed) {
      logSecurityEvent(SecurityEvents.LOGIN_FAILED, user._id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        reason: 'Account not confirmed',
      });
      res.status(401);
      throw new Error('Please verify your email before logging in');
    }
    logSecurityEvent(SecurityEvents.LOGIN_SUCCESS, user._id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      userProfileId: userProfileId, // This is the id of the profile of the trainer
      token: generateToken(user._id),
    });
  } else {
    logSecurityEvent(SecurityEvents.LOGIN_FAILED, email, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Invalid credentials',
    });
    res.status(401);
    throw new Error('Invalid user name or password.');
  }
});

// @description: Register new userReviewer
// @route: POST /api/user-reviews
// @access: Public
const registerUserReviewer = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const userExists = await UserReviewer.findOne({ email: email });

  if (userExists) {
    logSecurityEvent(SecurityEvents.REGISTRATION_FAILED, email, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Email already exists',
    });
    res.status(400);
    throw new Error('User already exists');
  }
  const userReviewer = await UserReviewer.create({
    name: name,
    email: email,
    password: password,
    isConfirmed: false,
    hasSubmittedReview: false,
  });

  if (userReviewer) {
    res.status(201).json({
      _id: userReviewer._id,
      name: userReviewer.name,
      email: userReviewer.email,
      isConfirmed: userReviewer.isConfirmed,
      hasSubmittedReview: userReviewer.hasSubmittedReview,
      token: generateToken(userReviewer._id),
    });

    // create reusable transporter object using the default SMTP transport
    let transporter = nodemailer.createTransport({
      host: process.env.MAILER_HOST,
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.MAILER_USER,
        pass: process.env.MAILER_PW,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
        minVersion: 'TLSv1.2', // Enforce minimum TLS version
      },
    });

    const link = `${process.env.MAILER_LOCAL_URL.replace(
      /\/$/,
      '',
    )}/api/verifyReviewer?token=${generateEmailVerificationToken(
      userReviewer._id,
    )}`;

    try {
      // send mail with defined transport object
      let info = await transporter.sendMail({
        from: '"Body Vantage" <info@bodyvantage.co.uk>', // sender address
        to: `${userReviewer.email}`, // list of receivers
        bcc: 'info@bodyvantage.co.uk',
        subject: 'Body Vantage Reviewer Registration', // Subject line
        text: 'Body Vantage Reviewer Registration', // plain text body
        html: `
  <h1>Hi ${userReviewer.name}</h1>
  <p>You have successfully registered to write a review for a client with Body Vantage</p>
  <p>Please Click on the link to verify your email.</p>
  <br>
  <h4>Please note, in order to get full functionality you must confirm your mail address with the link below.</h4>
  <a href=${link} id='link'>Click here to verify</a>
  <p>Thank you. Body Vantage management</p>
      
   
  `, // html body
      });

      console.log('Message sent: %s', info.messageId);
      // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

      // Preview only available when sending through an Ethereal account
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
      // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
    } catch (emailError) {
      logError('Failed to send reviewer verification email', emailError, {
        userId: userReviewer._id,
        email: userReviewer.email,
      });
    }

    logSecurityEvent(SecurityEvents.REGISTRATION_SUCCESS, userReviewer._id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
  } else {
    res.status(400);
    throw new Error('Invalid userReviewer data');
  }
});

// @description: Request password reset for reviewer
// @route: POST /api/reviewer-forgot-password
// @access: Public
const reviewerForgotPassword = asyncHandler(async (req, res) => {
  const { error, value } = forgotPasswordSchema.validate(req.body, {
    stripUnknown: true,
    abortEarly: false,
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const { email } = value;
  const reviewer = await UserReviewer.findOne({ email });

  if (reviewer) {
    try {
      const resetToken = generatePasswordResetToken(reviewer._id);
      reviewer.createPasswordResetToken(resetToken);
      reviewer.resetPasswordLastAttempt = Date.now();
      await reviewer.save();

      await sendPasswordResetEmail(reviewer, resetToken);
      logSecurityEvent(SecurityEvents.PASSWORD_RESET_REQUESTED, reviewer._id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (emailError) {
      logError('Failed to send reviewer password reset email', emailError, {
        userId: reviewer._id,
        email: reviewer.email,
      });
    }
  }

  res.status(200).json({
    message: 'If that email exists in our system, a password reset link has been sent.',
  });
});

// @description: Update reviewer password using reset token
// @route: PUT /api/reviewer-update-password
// @access: Public
const updateReviewerPassword = asyncHandler(async (req, res) => {
  const { error, value } = resetPasswordSchema.validate(req.body, {
    stripUnknown: true,
    abortEarly: false,
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const { resetPasswordToken, password } = value;

  let decodedToken;
  try {
    decodedToken = jwt.verify(resetPasswordToken, process.env.JWT_SECRET);
    if (decodedToken.type !== 'password_reset') {
      throw new Error('Invalid token type');
    }
  } catch (err) {
    logSecurityEvent(SecurityEvents.PASSWORD_RESET_FAILED, 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Invalid or expired token',
    });
    res.status(401);
    throw new Error('Invalid or expired reset token');
  }

  const hashedToken = crypto
    .createHash('sha256')
    .update(resetPasswordToken)
    .digest('hex');

  const reviewer = await UserReviewer.findOne({
    _id: decodedToken.id,
    resetPasswordToken: hashedToken,
    resetPasswordTokenExpiry: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordTokenExpiry');

  if (!reviewer) {
    logSecurityEvent(SecurityEvents.PASSWORD_RESET_FAILED, decodedToken.id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Token not found or expired',
    });
    res.status(404);
    throw new Error('Invalid or expired reset token');
  }

  reviewer.password = password;
  reviewer.clearPasswordResetToken();
  await reviewer.save();

  try {
    await sendPasswordChangedEmail(reviewer);
  } catch (emailError) {
    // Password change succeeded; email is secondary
    logError('Failed to send reviewer password changed email', emailError, {
      userId: reviewer._id,
    });
  }

  logSecurityEvent(SecurityEvents.PASSWORD_RESET_COMPLETED, reviewer._id, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json({
    message: 'Password successfully updated',
  });
});

export {
  getAllUsersReviews,
  getAllUsersReviewers,
  deleteReviewer,
  authUserReview,
  registerUserReviewer,
  reviewerForgotPassword,
  updateReviewerPassword,
};
