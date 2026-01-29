import asyncHandler from 'express-async-handler';
import Profile from '../models/profileModel.js';
import ProfileImages from '../models/profileImageModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import User from '../models/userModel.js';
import { sendReviewNotification } from '../utils/emailService.js';
import {
  updateProfileStats,
  syncKeywordsArray,
  PROFILE_CONSTANTS,
  ALLOWED_UPDATE_FIELDS,
} from '../utils/profileHelpers.js';
import { validateObjectId } from '../validators/commonValidators.js';

// @description: Get All the Profiles with pagination and filtering
// @route: GET /api/profiles
// @access: Public
// Query parameters: page, limit, location, specialisation, search
const getAllProfiles = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(
    parseInt(req.query.limit) || PROFILE_CONSTANTS.DEFAULT_PAGE_SIZE,
    PROFILE_CONSTANTS.MAX_PAGE_SIZE
  );
  const skip = (page - 1) * limit;

  // Build filter from query parameters
  const filter = {};

  // Handle search query using MongoDB text search
  if (req.query.search && req.query.search.trim()) {
    // Use $text operator for full-text search across indexed fields
    filter.$text = { $search: req.query.search.trim() };
  }

  // Additional filters (can be combined with search)
  if (req.query.location) {
    filter.location = new RegExp(req.query.location.trim(), 'i');
  }
  if (req.query.specialisation) {
    filter.specialisation = new RegExp(req.query.specialisation.trim(), 'i');
  }

  // Build query
  let query = Profile.find(filter).select(
    'name profileImage specialisation location rating numReviews description keywords specialisationOne specialisationTwo specialisationThree specialisationFour'
  );

  // Sort by text score if search is active, otherwise sort by rating
  if (filter.$text) {
    query = query
      .select({ score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' }, rating: -1 });
  } else {
    query = query.sort({ rating: -1, numReviews: -1 });
  }

  // Execute queries in parallel for better performance
  const [profiles, total] = await Promise.all([
    query.skip(skip).limit(limit).lean(),
    Profile.countDocuments(filter),
  ]);

  res.json({
    profiles,
    page,
    pages: Math.ceil(total / limit),
    total,
    hasSearch: !!req.query.search,
  });
});

// @description: Get All the users Profiles (Admin view with all fields)
// @route: GET /api/profiles/admin
// @access: Admin
// 🔴 FRONTEND IMPACT: Response format changed - now returns paginated object
const getAllProfilesAdmin = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(
    parseInt(req.query.limit) || PROFILE_CONSTANTS.DEFAULT_PAGE_SIZE,
    PROFILE_CONSTANTS.MAX_PAGE_SIZE
  );
  const skip = (page - 1) * limit;

  // Build filter
  const filter = {};
  if (req.query.location) {
    filter.location = new RegExp(req.query.location, 'i');
  }
  if (req.query.specialisation) {
    filter.specialisation = new RegExp(req.query.specialisation, 'i');
  }

  const [profiles, total] = await Promise.all([
    Profile.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Profile.countDocuments(filter),
  ]);

  res.json({
    profiles,
    page,
    pages: Math.ceil(total / limit),
    total,
  });
});

// @description: Fetch single Profile
// @route: GET /api/profiles/:id
// @access: Public
const getProfileById = asyncHandler(async (req, res) => {
  // Validate ObjectId format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid profile ID format');
  }

  const profile = await Profile.findById(req.params.id);

  if (profile) {
    res.json(profile);
  } else {
    res.status(404);
    throw new Error('Profile not found');
  }
});

// @description: Add profile after registration
// @route: POST /api/profiles
// @access: Private and Admin
const createProfile = asyncHandler(async (req, res) => {
  // Check if profile already exists for this user
  const existingProfile = await Profile.findOne({ user: req.user._id });

  if (existingProfile) {
    res.status(400);
    throw new Error('Profile already exists for this user');
  }

  // Create profile with user's email and name from their account
  const profile = new Profile({
    user: req.user._id,
    name: req.user.name || '',
    email: req.user.email || undefined, // Use undefined instead of empty string for sparse index
    faceBook: '',
    instagram: '',
    profileImage: PROFILE_CONSTANTS.DEFAULT_PROFILE_IMAGE,
    specialisation: '',
    location: '',
    qualifications: '',
    isQualificationsVerified: false,
    telephoneNumber: '',
    keywords: [], // New array-based keywords field
    keyWordSearchOne: '',
    keyWordSearchTwo: '',
    keyWordSearchThree: '',
    keyWordSearchFour: '',
    keyWordSearchFive: '',
    specialisationOne: '',
    specialisationTwo: '',
    specialisationThree: '',
    specialisationFour: '',
    rating: 0,
    showName: false,
    description: '',
    numReviews: 0,
  });

  const createdProfile = await profile.save();
  res.status(201).json(createdProfile);
});

// @description: User Profile
// @route: GET /api/profile
// @access: PRIVATE
const getProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ user: req.user._id });

  // Return null instead of 404 if profile doesn't exist
  // This is expected for users who haven't created a profile yet
  if (!profile) {
    return res.json(null);
  }

  res.json(profile);
});

// @description: Update Profile CLICKS
// @route: PUT /api/profile-clicks
// @access: PUBLIC
// 🔴 FRONTEND IMPACT: Now only accepts _id, server controls increment
const updateProfileClicks = asyncHandler(async (req, res) => {
  // Validate ObjectId format
  if (!validateObjectId(req.body._id)) {
    res.status(400);
    throw new Error('Invalid profile ID format');
  }

  // Server controls increment - user cannot manipulate counter value
  const profile = await Profile.findByIdAndUpdate(
    req.body._id,
    { $inc: { profileClickCounter: 1 } }, // Server increments by 1 only
    { new: true, select: 'profileClickCounter' } // Return only the counter field
  );

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  // Return minimal data
  res.json({ success: true, clickCount: profile.profileClickCounter });
});

// @description: Update Profile
// @route: PUT /api/profile
// @access: PRIVATE
// Automatically syncs keywords array from individual keyword fields
const updateProfile = asyncHandler(async (req, res) => {
  // Use authenticated user's ID only - never trust URL params or body for user ID
  const profile = await Profile.findOne({ user: req.user._id });

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  // Only update allowed fields (whitelist approach prevents mass assignment)
  ALLOWED_UPDATE_FIELDS.forEach((field) => {
    if (req.body[field] !== undefined) {
      profile[field] = req.body[field];
    }
  });

  // Sync keywords array from individual keyword fields for search indexing
  // This ensures the text index is always up to date
  syncKeywordsArray(profile);

  const updatedProfile = await profile.save();
  res.json(updatedProfile);
});

// @description: Delete a single profile
// @route: DELETE /api/profiles/admin/:id
// @access: PRIVATE/Admin
const deleteProfile = asyncHandler(async (req, res) => {
  // Validate ObjectId format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid profile ID format');
  }

  const profile = await Profile.findById(req.params.id);

  if (profile) {
    await profile.deleteOne();
    res.json({ message: 'Profile successfully removed' });
  } else {
    res.status(404);
    throw new Error('Profile not found');
  }
});

// @description: Delete a single review
// @route: DELETE /api/profiles/:id/reviews
// @access: PRIVATE/Admin
// 🔴 FRONTEND IMPACT: reviewId now expected in body, not as URL param
const deleteReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.body;

  // Validate ObjectId formats
  if (!validateObjectId(req.params.id) || !validateObjectId(reviewId)) {
    res.status(400);
    throw new Error('Invalid ID format');
  }

  // Get the profile
  const profile = await Profile.findById(req.params.id);

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  // Find and remove the review
  const reviewIndex = profile.reviews.findIndex(
    (r) => r._id.toString() === reviewId
  );

  if (reviewIndex === -1) {
    res.status(404);
    throw new Error('Review not found');
  }

  profile.reviews.splice(reviewIndex, 1);

  // Recalculate stats using helper
  updateProfileStats(profile);

  // Single atomic save (no race conditions)
  await profile.save();

  res.json({ message: 'Review successfully removed' });
});

// @description: CREATE a new review
// @route: POST /api/profiles/:id/reviews
// @access: Private
// 🔴 FRONTEND IMPACT: Stricter validation on acceptConditions (must be true)
const createProfileReview = asyncHandler(async (req, res) => {
  const { rating, comment, showName, userProfileId, acceptConditions } =
    req.body;

  // Validate reviewer ID format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid reviewer ID format');
  }

  // Validate user profile ID format
  if (!validateObjectId(userProfileId)) {
    res.status(400);
    throw new Error('Invalid user profile ID format');
  }

  // Get reviewer profile
  const reviewerProfile = await UserReviewer.findById(req.params.id);
  if (!reviewerProfile) {
    res.status(404);
    throw new Error('Reviewer profile not found');
  }
  if (reviewerProfile.isConfirmed !== true) {
    res.status(403);
    throw new Error('Please confirm your email address before submitting a review');
  }

  // Get target profile (use findOne, not find)
  const profile = await Profile.findOne({ user: userProfileId });
  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  // Get target user for email notification
  const user = await User.findById(userProfileId);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // PREVENT SELF-REVIEW
  if (
    reviewerProfile.userProfileId &&
    reviewerProfile.userProfileId.toString() === userProfileId.toString()
  ) {
    res.status(400);
    throw new Error('You cannot review your own profile');
  }

  // Check if already reviewed (more efficient)
  const alreadyReviewed = profile.reviews.some(
    (r) => r.user.toString() === req.params.id
  );

  if (alreadyReviewed) {
    res.status(400);
    throw new Error('You have already reviewed this profile');
  }

  // ENFORCE conditions acceptance (strict boolean check)
  if (acceptConditions !== true) {
    res.status(400);
    throw new Error('You must accept the review conditions');
  }

  const review = {
    user: req.params.id,
    name: reviewerProfile.name,
    showName,
    rating: Number(rating),
    comment,
    userProfileId: reviewerProfile.userProfileId,
    hasAccepted: true,
  };

  profile.reviews.push(review);

  // Update stats using helper
  updateProfileStats(profile);

  await profile.save();

  // Mark reviewer as having submitted (optional business logic)
  reviewerProfile.hasSubmittedReview = true;
  await reviewerProfile.save();

  // Send email notification (non-blocking - don't fail if email fails)
  try {
    await sendReviewNotification(user.email, user.name, review.name, review.comment);
  } catch (emailError) {
    // Log error but don't fail the request - review was created successfully
    console.error('Failed to send review notification:', emailError.message);
  }

  res.status(201).json({ message: 'Review added successfully' });
});

// @description: Update Qualification to true/false
// @route: PUT /api/profiles/:id/verified
// @access: Private/Admin
const updateProfileQualificationToTrue = asyncHandler(async (req, res) => {
  // Validate ObjectId format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid profile ID format');
  }

  const profile = await Profile.findById(req.params.id);

  if (profile) {
    profile.isQualificationsVerified = true;
    const updateProfile = await profile.save();
    res.json(updateProfile);
  } else {
    res.status(404);
    throw new Error('Profile not found');
  }
});

// @description: Get profile images
// @route: GET /api/profile-images
// @access: Private
// 🔴 FRONTEND IMPACT: Response format changed - now returns paginated object
const getAllProfileImages = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(
    parseInt(req.query.limit) || PROFILE_CONSTANTS.DEFAULT_PAGE_SIZE,
    PROFILE_CONSTANTS.MAX_PAGE_SIZE
  );
  const skip = (page - 1) * limit;

  const [profileImages, total] = await Promise.all([
    ProfileImages.find({ user: req.user._id })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProfileImages.countDocuments({ user: req.user._id }),
  ]);

  res.json({
    images: profileImages,
    page,
    pages: Math.ceil(total / limit),
    total,
  });
});

// @description: Get profile images Public
// @route: GET /api/profile-images-public/:id
// @access: Public
// 🔴 FRONTEND IMPACT: Response format changed - now returns paginated object
const getAllProfileImagesPublic = asyncHandler(async (req, res) => {
  // Validate ObjectId format
  if (!validateObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid user ID format');
  }

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(
    parseInt(req.query.limit) || PROFILE_CONSTANTS.DEFAULT_PAGE_SIZE,
    PROFILE_CONSTANTS.MAX_PAGE_SIZE
  );
  const skip = (page - 1) * limit;

  const [profileImages, total] = await Promise.all([
    ProfileImages.find({ user: req.params.id })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProfileImages.countDocuments({ user: req.params.id }),
  ]);

  res.json({
    images: profileImages,
    page,
    pages: Math.ceil(total / limit),
    total,
  });
});

export {
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
};
