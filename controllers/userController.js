import asyncHandler from 'express-async-handler';
import generateToken, { generateEmailVerificationToken, generatePasswordResetToken, generateEmailChangeToken } from '../utils/generateToken.js';
import User from '../models/userModel.js';
import Profile from '../models/profileModel.js';
import ProfileImages from '../models/profileImageModel.js';
import UserProfileImages from '../models/imageUploadModal.js';
import cloudinary from 'cloudinary';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import crypto from 'crypto';
import {
  loginSchema,
  registerSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateIsAdminSchema,
  validateObjectId
} from '../validators/userValidator.js';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmailChangeVerification
} from '../services/emailService.js';
import { logSecurityEvent, SecurityEvents, logError } from '../utils/auditLogger.js';

// @description: Get All the users Profiles
// @route: GET /api/users
// @access: Admin
const getAllUsersProfile = asyncHandler(async (req, res) => {
  const users = await User.find({});
  if (users) {
    res.json(users);
  } else {
    res.status(404);
    throw new Error('No users found');
  }
});

// @description: Authenticate a user and get a token
// @route: POST /api/users/login
// @access: Public
const authUser = asyncHandler(async (req, res) => {
  // Validate input
  const { error, value } = loginSchema.validate(req.body, {
    stripUnknown: true,
    abortEarly: false
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const { email, password } = value;

  // Find user
  const user = await User.findOne({ email });

  // Always check password even if user doesn't exist (prevent timing attacks)
  const dummyHash = '$2a$10$invalidhashfortimingequalityxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const isValidPassword = user
    ? await user.matchPassword(password)
    : await bcrypt.compare(password, dummyHash);

  if (user && isValidPassword) {
    // Check if account is confirmed
    if (!user.isConfirmed) {
      logSecurityEvent(SecurityEvents.LOGIN_FAILED, user._id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        reason: 'Account not confirmed'
      });
      res.status(401);
      throw new Error('Please verify your email before logging in');
    }

    // Log successful login
    logSecurityEvent(SecurityEvents.LOGIN_SUCCESS, user._id, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    });
  } else {
    // Log failed login attempt
    logSecurityEvent(SecurityEvents.LOGIN_FAILED, email, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Invalid credentials'
    });

    res.status(401);
    throw new Error('Invalid credentials');
  }
});

// @description: Register new user
// @route: POST /api/users
// @access: Public
const registerUser = asyncHandler(async (req, res) => {
  // Validate input
  const { error, value } = registerSchema.validate(req.body, {
    stripUnknown: true,
    abortEarly: false
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const { name, email, password } = value;

  // Check if user already exists
  const userExists = await User.findOne({ email });

  if (userExists) {
    logSecurityEvent(SecurityEvents.REGISTRATION_FAILED, email, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Email already exists'
    });
    res.status(400);
    throw new Error('User already exists');
  }

  // Create user
  const user = await User.create({
    name,
    email,
    password,
  });

  if (user) {
    try {
      // Generate email verification token (separate from auth token)
      const verificationToken = generateEmailVerificationToken(user._id);

      // Send verification email
      await sendVerificationEmail(user, verificationToken);

      // Log successful registration
      logSecurityEvent(SecurityEvents.REGISTRATION_SUCCESS, user._id, {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isConfirmed: user.isConfirmed,
        token: generateToken(user._id),
        message: 'Registration successful. Please check your email to verify your account.'
      });
    } catch (emailError) {
      // Log error but don't fail registration
      logError('Failed to send verification email', emailError, {
        userId: user._id,
        email: user.email
      });

      // User is created but email failed - still return success
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        isConfirmed: user.isConfirmed,
        token: generateToken(user._id),
        message: 'Registration successful. Verification email could not be sent. Please contact support.'
      });
    }
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

// @description: User Profile
// @route: GET /api/users/profile
// @access: PRIVATE
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      isConfirmed: user.isConfirmed,
      profileImage: user.profileImage,
      cloudinaryId: user.cloudinaryId,
    });
  } else {
    res.status(404);
    throw new Error('No user found');
  }
});

// @description: Update User Profile
// @route: PUT /api/users/profile
// @access: PRIVATE
const updateUserProfile = asyncHandler(async (req, res) => {
  // Validate input
  const { error, value } = updateProfileSchema.validate(req.body, {
    stripUnknown: true, // Remove fields not in schema (like 'id')
    abortEarly: false
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // If changing password, verify current password
  if (value.password) {
    if (!value.currentPassword) {
      res.status(400);
      throw new Error('Current password required to change password');
    }

    const isValidPassword = await user.matchPassword(value.currentPassword);
    if (!isValidPassword) {
      logSecurityEvent(SecurityEvents.UNAUTHORIZED_ACCESS_ATTEMPT, user._id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        reason: 'Invalid current password on profile update'
      });
      res.status(401);
      throw new Error('Current password is incorrect');
    }

    user.password = value.password;
  }

  // If changing email, require verification
  if (value.email && value.email !== user.email) {
    // Check if email already exists
    const emailExists = await User.findOne({ email: value.email });
    if (emailExists) {
      res.status(400);
      throw new Error('Email already in use');
    }

    // Store pending email change
    user.pendingEmail = value.email;
    const emailChangeToken = generateEmailChangeToken(user._id);
    user.emailChangeToken = crypto.createHash('sha256').update(emailChangeToken).digest('hex');
    user.emailChangeTokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour

    // Send verification email to NEW email
    try {
      await sendEmailChangeVerification(value.email, emailChangeToken, user.name);

      logSecurityEvent(SecurityEvents.EMAIL_CHANGE_REQUESTED, user._id, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        newEmail: value.email
      });
    } catch (emailError) {
      logError('Failed to send email change verification', emailError, {
        userId: user._id,
        newEmail: value.email
      });
      res.status(500);
      throw new Error('Failed to send verification email. Please try again.');
    }

    // Don't update email yet - wait for verification
  }

  // Update name if provided
  if (value.name) {
    user.name = value.name;
  }

  const updatedUser = await user.save();

  logSecurityEvent(SecurityEvents.PROFILE_UPDATED, user._id, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    changes: {
      name: value.name ? true : false,
      email: value.email ? 'pending_verification' : false,
      password: value.password ? true : false
    }
  });

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    isAdmin: updatedUser.isAdmin,
    token: generateToken(updatedUser._id),
    message: value.email ? 'Profile updated. Verification email sent to new address.' : 'Profile updated successfully'
  });
});

// @description: Fetch single Profile
// @route: GET /api/user/profile/:id
// @access: Public
const getUserProfileById = asyncHandler(async (req, res) => {
  // Validate MongoDB ObjectId format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid user ID format');
  }

  // Only select public fields
  const userProfile = await User.findById(req.params.id)
    .select('name profileImage isConfirmed createdAt');

  if (userProfile) {
    res.json(userProfile);
  } else {
    res.status(404);
    throw new Error('Profile not found');
  }
});

// @description: Delete a single user with all related data
// @route: DELETE /api/users/:id
// @access: PRIVATE/Admin
const deleteUser = asyncHandler(async (req, res) => {
  // Validate MongoDB ObjectId format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid user ID format');
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('User Not Found');
  }

  // Prevent self-deletion
  if (user._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error('Cannot delete your own account');
  }

  // Configure Cloudinary
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });

  // Start MongoDB transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const deletionStats = {
      profileImages: 0,
      userProfileImages: 0,
      profile: 0,
      cloudinaryFiles: 0,
      user: 0
    };

    // 1. Delete all ProfileImages (profile page images) and their Cloudinary files
    const profileImages = await ProfileImages.find({ user: req.params.id }).session(session);
    for (const image of profileImages) {
      if (image.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(image.cloudinaryId);
          deletionStats.cloudinaryFiles++;
        } catch (cloudError) {
          // Log error but continue - don't fail transaction for Cloudinary errors
          logError('Failed to delete Cloudinary image', cloudError, {
            imageId: image.cloudinaryId,
            userId: req.params.id
          });
        }
      }
      await image.deleteOne({ session });
      deletionStats.profileImages++;
    }

    // 2. Delete all UserProfileImages (user account images) and their Cloudinary files
    const userProfileImages = await UserProfileImages.find({ user: req.params.id }).session(session);
    for (const image of userProfileImages) {
      if (image.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(image.cloudinaryId);
          deletionStats.cloudinaryFiles++;
        } catch (cloudError) {
          logError('Failed to delete Cloudinary image', cloudError, {
            imageId: image.cloudinaryId,
            userId: req.params.id
          });
        }
      }
      await image.deleteOne({ session });
      deletionStats.userProfileImages++;
    }

    // 3. Delete the user's Profile (this also deletes embedded reviews)
    const profile = await Profile.findOne({ user: req.params.id }).session(session);
    if (profile) {
      // Delete profile's main image from Cloudinary if it exists
      if (profile.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(profile.cloudinaryId);
          deletionStats.cloudinaryFiles++;
        } catch (cloudError) {
          logError('Failed to delete Cloudinary image', cloudError, {
            imageId: profile.cloudinaryId,
            userId: req.params.id
          });
        }
      }
      await profile.deleteOne({ session });
      deletionStats.profile = 1;
    }

    // 4. Delete the User
    await user.deleteOne({ session });
    deletionStats.user = 1;

    // Commit transaction
    await session.commitTransaction();

    // Log user deletion
    logSecurityEvent(SecurityEvents.USER_DELETED, req.params.id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      deletedBy: req.user._id,
      stats: deletionStats
    });

    res.json({
      message: 'User and all related data successfully removed',
      deleted: deletionStats
    });
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();

    logError('Error during user deletion', error, {
      userId: req.params.id,
      deletedBy: req.user._id
    });

    res.status(500);
    throw new Error(`Error deleting user and related data: ${error.message}`);
  } finally {
    session.endSession();
  }
});

// @description: Update isAdmin to true/false
// @route: PUT /user/profile/:id
// @access: Private/Admin
const updateIsAdmin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    if (typeof req.body.val !== 'boolean') {
      res.status(400);
      throw new Error('isAdmin update requires a boolean value');
    }

    user.isAdmin = req.body.val;
    const updateIsAdmin = await user.save();
    res.json(updateIsAdmin);
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const userForgotPassword = asyncHandler(async (req, res) => {
  // Validate input
  const { error, value } = forgotPasswordSchema.validate(req.body, {
    stripUnknown: true,
    abortEarly: false
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const { email } = value;

  // Find user
  const user = await User.findOne({ email });

  if (user) {
    try {
      // Generate password reset token
      const resetToken = generatePasswordResetToken(user._id);

      // Hash and store token with expiry
      user.createPasswordResetToken(resetToken);
      user.resetPasswordLastAttempt = Date.now();
      await user.save();

      // Send password reset email
      await sendPasswordResetEmail(user, resetToken);

      // Log password reset request
      logSecurityEvent(SecurityEvents.PASSWORD_RESET_REQUESTED, user._id, {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch (emailError) {
      // Log error but still return generic success message
      logError('Failed to send password reset email', emailError, {
        userId: user._id,
        email: user.email
      });
    }
  }

  // ALWAYS return success to prevent user enumeration
  res.status(200).json({
    message: 'If that email exists in our system, a password reset link has been sent.'
  });
});

// @description: Update User PASSWORD
// @route: PUT /api/user-update-password
// @access: PUBLIC
const updateUserProfilePassword = asyncHandler(async (req, res) => {
  // Validate input
  const { error, value } = resetPasswordSchema.validate(req.body, {
    stripUnknown: true,
    abortEarly: false
  });
  if (error) {
    res.status(400);
    throw new Error(error.details[0].message);
  }

  const { resetPasswordToken, password } = value;

  // Verify JWT token
  let decodedToken;
  try {
    decodedToken = jwt.verify(resetPasswordToken, process.env.JWT_SECRET);

    // Check token type
    if (decodedToken.type !== 'password_reset') {
      throw new Error('Invalid token type');
    }
  } catch (err) {
    logSecurityEvent(SecurityEvents.PASSWORD_RESET_FAILED, 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Invalid or expired token'
    });
    res.status(401);
    throw new Error('Invalid or expired reset token');
  }

  // Hash the token to compare with stored hash
  const hashedToken = crypto.createHash('sha256').update(resetPasswordToken).digest('hex');

  // Find user with matching hashed token and check expiry
  const user = await User.findOne({
    _id: decodedToken.id,
    resetPasswordToken: hashedToken,
    resetPasswordTokenExpiry: { $gt: Date.now() }
  });

  if (!user) {
    logSecurityEvent(SecurityEvents.PASSWORD_RESET_FAILED, decodedToken.id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: 'Token not found or expired'
    });
    res.status(404);
    throw new Error('Invalid or expired reset token');
  }

  // Update password and clear reset fields
  user.password = password;
  user.clearPasswordResetToken();
  await user.save();

  // Send confirmation email
  try {
    await sendPasswordChangedEmail(user);
  } catch (emailError) {
    logError('Failed to send password changed email', emailError, {
      userId: user._id
    });
  }

  // Log successful password reset
  logSecurityEvent(SecurityEvents.PASSWORD_RESET_COMPLETED, user._id, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.status(200).json({
    message: 'Password successfully updated'
  });
});

// @description: Verify email address
// @route: GET /api/verify
// @access: Public
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    res.status(400);
    throw new Error('Verification token is required');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check token type
    if (decoded.type !== 'email_verification') {
      res.status(401);
      throw new Error('Invalid verification token type');
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    if (user.isConfirmed) {
      return res.status(200).json({
        message: 'Email already verified'
      });
    }

    user.isConfirmed = true;
    await user.save();

    // Log email verification
    logSecurityEvent(SecurityEvents.EMAIL_VERIFIED, user._id, {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(200).json({
      message: 'Email successfully verified. You can now log in.'
    });
  } catch (error) {
    logSecurityEvent(SecurityEvents.EMAIL_VERIFICATION_FAILED, 'unknown', {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      reason: error.message
    });
    res.status(401);
    throw new Error('Invalid or expired verification token');
  }
});

// @description: Verify email change
// @route: GET /api/verify-email-change
// @access: Public
const verifyEmailChange = asyncHandler(async (req, res) => {
  const { token } = req.query;

  if (!token) {
    res.status(400);
    throw new Error('Verification token is required');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check token type
    if (decoded.type !== 'email_change') {
      res.status(401);
      throw new Error('Invalid verification token type');
    }

    // Hash the token to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      _id: decoded.id,
      emailChangeToken: hashedToken,
      emailChangeTokenExpiry: { $gt: Date.now() }
    });

    if (!user || !user.pendingEmail) {
      res.status(404);
      throw new Error('Invalid or expired email change token');
    }

    // Update email
    const oldEmail = user.email;
    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    user.emailChangeToken = undefined;
    user.emailChangeTokenExpiry = undefined;
    await user.save();

    // Log email change
    logSecurityEvent(SecurityEvents.EMAIL_CHANGE_VERIFIED, user._id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      oldEmail,
      newEmail: user.email
    });

    res.status(200).json({
      message: 'Email successfully changed'
    });
  } catch (error) {
    logError('Email change verification failed', error, {
      token: token.substring(0, 10) + '...'
    });
    res.status(401);
    throw new Error('Invalid or expired verification token');
  }
});

export {
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
};
