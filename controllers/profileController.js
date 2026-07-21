import asyncHandler from 'express-async-handler';
import Profile from '../models/profileModel.js';
import ProfileImages from '../models/profileImageModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import User from '../models/userModel.js';
import { sendReviewNotification } from '../utils/emailService.js';
import { logSecurityEvent, SecurityEvents } from '../utils/auditLogger.js';
import {
  updateProfileStats,
  syncKeywordsArray,
  PROFILE_CONSTANTS,
  ALLOWED_UPDATE_FIELDS,
  QUALIFICATION_VERIFICATION_STATUSES,
  saveProfileQualificationSummary,
} from '../utils/profileHelpers.js';
import { validateObjectId } from '../validators/commonValidators.js';

const isOnboardingTutorialEnforced = () => {
  if (process.env.ONBOARDING_TUTORIAL_ENFORCED === undefined) {
    return process.env.NODE_ENV === 'production';
  }

  return process.env.ONBOARDING_TUTORIAL_ENFORCED === 'true';
};

const PROFILE_LIST_FIELDS = [
  'name',
  'profileImage',
  'specialisation',
  'location',
  'rating',
  'numReviews',
  'description',
  'keywords',
  'specialisationOne',
  'specialisationTwo',
  'specialisationThree',
  'specialisationFour',
];

const PROFILE_LIST_SELECT = PROFILE_LIST_FIELDS.join(' ');
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'area',
  'around',
  'at',
  'by',
  'for',
  'from',
  'in',
  'local',
  'me',
  'my',
  'near',
  'nearby',
  'of',
  'the',
  'to',
  'with',
]);

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSearchTerm = (value = '') =>
  value
    .trim()
    .replace(/[^\w\s'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseSearchQuery = (value = '') => {
  const normalized = normalizeSearchTerm(value).toLowerCase();
  const terms = [
    ...new Set(
      normalized
        .split(' ')
        .filter((term) => term.length >= 2 && !SEARCH_STOP_WORDS.has(term)),
    ),
  ];
  const phrases = [];

  if (terms.length > 1) {
    phrases.push(terms.join(' '));
  }

  for (let idx = 0; idx < terms.length - 1; idx += 1) {
    phrases.push(`${terms[idx]} ${terms[idx + 1]}`);
  }

  return {
    normalized,
    terms,
    phrases: [...new Set(phrases)],
  };
};

const regexRank = (input, regex, score) => ({
  $cond: [
    {
      $regexMatch: {
        input,
        regex,
        options: 'i',
      },
    },
    score,
    0,
  ],
});

const buildSearchRankExpressions = ({
  terms,
  phrases,
  keywordTextExpression,
  specialisationTextExpression,
  allSearchableTextExpression,
}) => {
  const rankExpressions = [];

  terms.forEach((term) => {
    const escapedTerm = escapeRegex(term);
    const exactRegex = `^${escapedTerm}$`;
    const wordExactRegex = `(^|\\s)${escapedTerm}(\\s|$)`;
    const prefixRegex = `\\b${escapedTerm}`;
    const containsRegex = escapedTerm;

    rankExpressions.push(
      regexRank({ $ifNull: ['$name', ''] }, exactRegex, 95),
      regexRank({ $ifNull: ['$name', ''] }, prefixRegex, 76),
      regexRank({ $ifNull: ['$name', ''] }, containsRegex, 42),
      regexRank(keywordTextExpression, wordExactRegex, 82),
      regexRank(keywordTextExpression, prefixRegex, 66),
      regexRank(keywordTextExpression, containsRegex, 42),
      regexRank(specialisationTextExpression, wordExactRegex, 76),
      regexRank(specialisationTextExpression, prefixRegex, 60),
      regexRank(specialisationTextExpression, containsRegex, 38),
      regexRank({ $ifNull: ['$location', ''] }, exactRegex, 72),
      regexRank({ $ifNull: ['$location', ''] }, prefixRegex, 58),
      regexRank({ $ifNull: ['$location', ''] }, containsRegex, 36),
      regexRank({ $ifNull: ['$description', ''] }, prefixRegex, 12),
      regexRank({ $ifNull: ['$description', ''] }, containsRegex, 6),
      regexRank(allSearchableTextExpression, containsRegex, 3),
    );
  });

  phrases.forEach((phrase) => {
    const escapedPhrase = escapeRegex(phrase);
    const phraseRegex = `\\b${escapedPhrase}\\b`;
    const phrasePrefixRegex = `\\b${escapedPhrase}`;

    rankExpressions.push(
      regexRank({ $ifNull: ['$name', ''] }, phrasePrefixRegex, 95),
      regexRank(keywordTextExpression, phraseRegex, 115),
      regexRank(keywordTextExpression, phrasePrefixRegex, 92),
      regexRank(specialisationTextExpression, phraseRegex, 105),
      regexRank(specialisationTextExpression, phrasePrefixRegex, 84),
      regexRank({ $ifNull: ['$description', ''] }, phraseRegex, 24),
      regexRank(allSearchableTextExpression, phraseRegex, 12),
    );
  });

  return rankExpressions;
};

const buildProfileSearchBaseStages = ({ filter, searchParts }) => {
  const keywordTextExpression = {
    $reduce: {
      input: { $ifNull: ['$keywords', []] },
      initialValue: '',
      in: { $concat: ['$$value', ' ', '$$this'] },
    },
  };

  const specialisationTextExpression = {
    $concat: [
      { $ifNull: ['$specialisation', ''] },
      ' ',
      { $ifNull: ['$specialisationOne', ''] },
      ' ',
      { $ifNull: ['$specialisationTwo', ''] },
      ' ',
      { $ifNull: ['$specialisationThree', ''] },
      ' ',
      { $ifNull: ['$specialisationFour', ''] },
    ],
  };

  const allSearchableTextExpression = {
    $concat: [
      { $ifNull: ['$name', ''] },
      ' ',
      { $ifNull: ['$location', ''] },
      ' ',
      specialisationTextExpression,
      ' ',
      keywordTextExpression,
      ' ',
      { $ifNull: ['$description', ''] },
    ],
  };
  const searchRankExpressions = buildSearchRankExpressions({
    terms: searchParts.terms,
    phrases: searchParts.phrases,
    keywordTextExpression,
    specialisationTextExpression,
    allSearchableTextExpression,
  });

  // A multi-word query must remain relevant as a whole. Each meaningful term
  // has to appear somewhere in the searchable profile fields; scoring then
  // determines whether exact service/location matches rank above partial ones.
  const requiredTermMatches = searchParts.terms.map((term) => ({
    $regexMatch: {
      input: allSearchableTextExpression,
      regex: escapeRegex(term),
      options: 'i',
    },
  }));

  return [
    { $match: filter },
    ...(requiredTermMatches.length > 0
      ? [{ $match: { $expr: { $and: requiredTermMatches } } }]
      : []),
    {
      $addFields: {
        searchRank: {
          $add: searchRankExpressions,
        },
      },
    },
    { $match: { searchRank: { $gt: 0 } } },
  ];
};

const buildProfileSearchAggregation = ({ filter, searchParts, skip, limit }) => {
  const project = PROFILE_LIST_FIELDS.reduce(
    (fields, field) => ({
      ...fields,
      [field]: 1,
    }),
    {
      score: '$searchRank',
      searchRank: 1,
    },
  );

  return [
    ...buildProfileSearchBaseStages({ filter, searchParts }),
    { $sort: { searchRank: -1, rating: -1, numReviews: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: project },
  ];
};

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
  // A disabled or pending profile remains in storage, but must never leak into
  // the public directory. Account, payment and qualification state are untouched.
  const publicUserIds = await User.find({ publicProfileStatus: { $in: ['active', null] } })
    .select('_id')
    .lean();
  filter.user = { $in: publicUserIds.map(({ _id }) => _id) };
  const searchParts = parseSearchQuery(req.query.search || '');
  const hasSearch = searchParts.terms.length > 0;

  // Additional filters (can be combined with search)
  if (req.query.location) {
    filter.location = new RegExp(req.query.location.trim(), 'i');
  }
  if (req.query.specialisation) {
    filter.specialisation = new RegExp(req.query.specialisation.trim(), 'i');
  }

  let profilesQuery;
  let totalQuery;

  if (hasSearch) {
    profilesQuery = Profile.aggregate(
      buildProfileSearchAggregation({
        filter,
        searchParts,
        skip,
        limit,
      }),
    );
    totalQuery = Profile.aggregate([
      ...buildProfileSearchBaseStages({ filter, searchParts }),
      { $count: 'total' },
    ]);
  } else {
    profilesQuery = Profile.find(filter)
      .select(PROFILE_LIST_SELECT)
      .sort({ rating: -1, numReviews: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    totalQuery = Profile.countDocuments(filter);
  }

  // Execute queries in parallel for better performance
  const [profiles, totalResult] = await Promise.all([
    profilesQuery,
    totalQuery,
  ]);
  const total = hasSearch ? totalResult[0]?.total || 0 : totalResult;

  res.json({
    profiles,
    page,
    pages: Math.ceil(total / limit),
    total,
    hasSearch,
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

  const profileOwner = profile && await User.findById(profile.user).select('publicProfileStatus').lean();
  if (profile && (!profileOwner?.publicProfileStatus || profileOwner.publicProfileStatus === 'active')) {
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
    qualificationVerificationStatus: QUALIFICATION_VERIFICATION_STATUSES.NONE,
    qualificationStatusUpdatedAt: null,
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

  const onboardingTutorial = profile.onboardingTutorial || {};
  const tutorialIsRequired = onboardingTutorial.required !== false;
  const tutorialIsCompleted = onboardingTutorial.isCompleted === true;

  if (isOnboardingTutorialEnforced() && tutorialIsRequired && !tutorialIsCompleted) {
    logSecurityEvent(SecurityEvents.ONBOARDING_TUTORIAL_BLOCKED_SUBMIT, req.user._id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      profileId: profile._id,
    });

    return res.status(403).json({
      success: false,
      message: 'Onboarding tutorial interaction is required before profile submission.',
      code: 'ONBOARDING_TUTORIAL_REQUIRED',
    });
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

// @description: Update onboarding tutorial status for current user profile
// @route: PATCH /api/profile/onboarding-tutorial
// @access: PRIVATE
const updateOnboardingTutorialStatus = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ user: req.user._id });

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  if (!profile.onboardingTutorial) {
    profile.onboardingTutorial = {};
  }

  if (profile.onboardingTutorial.required === undefined) {
    profile.onboardingTutorial.required = true;
  }
  if (profile.onboardingTutorial.hasInteracted === undefined) {
    profile.onboardingTutorial.hasInteracted = false;
  }
  if (profile.onboardingTutorial.watchProgressPercent === undefined) {
    profile.onboardingTutorial.watchProgressPercent = 0;
  }
  if (profile.onboardingTutorial.manualAcknowledged === undefined) {
    profile.onboardingTutorial.manualAcknowledged = false;
  }
  if (profile.onboardingTutorial.completionThresholdPercent === undefined) {
    profile.onboardingTutorial.completionThresholdPercent = 90;
  }
  if (profile.onboardingTutorial.isCompleted === undefined) {
    profile.onboardingTutorial.isCompleted = false;
  }
  if (profile.onboardingTutorial.version === undefined) {
    profile.onboardingTutorial.version = 'v1';
  }

  const previousIsCompleted = profile.onboardingTutorial.isCompleted === true;
  const now = new Date();

  if (req.body.hasInteracted !== undefined) {
    profile.onboardingTutorial.hasInteracted = req.body.hasInteracted;
  }

  if (req.body.interactionType !== undefined) {
    profile.onboardingTutorial.interactionType = req.body.interactionType;
    profile.onboardingTutorial.hasInteracted = true;
  }

  if (req.body.watchProgressPercent !== undefined) {
    profile.onboardingTutorial.watchProgressPercent = req.body.watchProgressPercent;
  }

  if (req.body.manualAcknowledged !== undefined) {
    profile.onboardingTutorial.manualAcknowledged = req.body.manualAcknowledged;
  }

  const hasProgress = (profile.onboardingTutorial.watchProgressPercent || 0) > 0;
  if (
    profile.onboardingTutorial.hasInteracted === true ||
    hasProgress ||
    profile.onboardingTutorial.manualAcknowledged === true
  ) {
    profile.onboardingTutorial.hasInteracted = true;
    if (!profile.onboardingTutorial.firstInteractedAt) {
      profile.onboardingTutorial.firstInteractedAt = now;
    }
  }

  const completionThreshold =
    profile.onboardingTutorial.completionThresholdPercent || 90;
  const completionSignal =
    (profile.onboardingTutorial.watchProgressPercent || 0) >= completionThreshold ||
    profile.onboardingTutorial.manualAcknowledged === true;

  profile.onboardingTutorial.isCompleted = previousIsCompleted || completionSignal;

  if (profile.onboardingTutorial.isCompleted && !previousIsCompleted) {
    profile.onboardingTutorial.completedAt = now;

    if (!req.body.interactionType) {
      profile.onboardingTutorial.interactionType =
        profile.onboardingTutorial.manualAcknowledged === true
          ? 'manual_ack'
          : 'completed';
    }
  }

  const updatedProfile = await profile.save();

  if (!previousIsCompleted && updatedProfile.onboardingTutorial?.isCompleted) {
    logSecurityEvent(SecurityEvents.ONBOARDING_TUTORIAL_COMPLETED, req.user._id, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      profileId: updatedProfile._id,
      completionMethod:
        updatedProfile.onboardingTutorial.manualAcknowledged === true
          ? 'manual_ack'
          : 'watch_progress',
      watchProgressPercent: updatedProfile.onboardingTutorial.watchProgressPercent,
    });
  }

  res.json({
    success: true,
    onboardingTutorial: updatedProfile.onboardingTutorial,
  });
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
    const updateProfile = await saveProfileQualificationSummary(
      profile,
      QUALIFICATION_VERIFICATION_STATUSES.APPROVED,
      new Date(),
    );
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

  const profileOwner = await User.findById(req.params.id)
    .select('publicProfileStatus')
    .lean();
  if (!profileOwner || (profileOwner.publicProfileStatus && profileOwner.publicProfileStatus !== 'active')) {
    res.status(404);
    throw new Error('Profile not found');
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
  updateOnboardingTutorialStatus,
};
