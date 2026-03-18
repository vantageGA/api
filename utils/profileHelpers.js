import QualificationDocument from '../models/qualificationDocumentModel.js';

/**
 * Calculate the average rating from an array of reviews
 * @param {Array} reviews - Array of review objects with rating property
 * @returns {number} Average rating (0 if no reviews)
 */
export const calculateProfileRating = (reviews) => {
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
  return sum / reviews.length;
};

/**
 * Update profile statistics (numReviews and rating)
 * Modifies the profile object in place
 * @param {Object} profile - Mongoose profile document
 */
export const updateProfileStats = (profile) => {
  profile.numReviews = profile.reviews.length;
  profile.rating = calculateProfileRating(profile.reviews);
};

/**
 * Sync keywords array from individual keyword fields
 * This maintains backward compatibility with legacy fields
 * @param {Object} profile - Mongoose profile document
 */
export const syncKeywordsArray = (profile) => {
  const keywordFields = [
    profile.keyWordSearchOne,
    profile.keyWordSearchTwo,
    profile.keyWordSearchThree,
    profile.keyWordSearchFour,
    profile.keyWordSearchFive,
  ];

  // Filter out empty strings and trim whitespace
  profile.keywords = keywordFields
    .filter((keyword) => keyword && keyword.trim().length >= 3)
    .map((keyword) => keyword.trim().toLowerCase());
};

export const QUALIFICATION_VERIFICATION_STATUSES = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const isValidQualificationVerificationStatus = (status) =>
  Object.values(QUALIFICATION_VERIFICATION_STATUSES).includes(status);

export const updateProfileQualificationSummary = (
  profile,
  status,
  updatedAt = new Date(),
) => {
  if (!isValidQualificationVerificationStatus(status)) {
    throw new Error(`Invalid qualification verification status: ${status}`);
  }

  profile.qualificationVerificationStatus = status;
  profile.qualificationStatusUpdatedAt = updatedAt;
  profile.isQualificationsVerified =
    status === QUALIFICATION_VERIFICATION_STATUSES.APPROVED;

  return profile;
};

export const saveProfileQualificationSummary = async (
  profile,
  status,
  updatedAt = new Date(),
) => {
  updateProfileQualificationSummary(profile, status, updatedAt);
  await profile.save();
  return profile;
};

export const syncProfileQualificationSummaryFromActiveDocument = async (
  profile,
  fallbackDate = new Date(),
) => {
  const activeDocument = await QualificationDocument.findOne({
    profile: profile._id,
    isActive: true,
  }).sort({ createdAt: -1 });

  if (!activeDocument) {
    await saveProfileQualificationSummary(
      profile,
      QUALIFICATION_VERIFICATION_STATUSES.NONE,
      fallbackDate,
    );
    return null;
  }

  const updatedAt =
    activeDocument.reviewedAt ||
    activeDocument.updatedAt ||
    activeDocument.createdAt ||
    fallbackDate;

  await saveProfileQualificationSummary(profile, activeDocument.status, updatedAt);
  return activeDocument;
};

/**
 * Profile constants
 */
export const PROFILE_CONSTANTS = {
  MAX_KEYWORDS: 5,
  MAX_SPECIALISATIONS: 4,
  MAX_DESCRIPTION_LENGTH: 2000,
  MAX_QUALIFICATIONS_LENGTH: 1000,
  MIN_REVIEW_COMMENT_LENGTH: 10,
  MAX_REVIEW_COMMENT_LENGTH: 1000,
  MIN_RATING: 1,
  MAX_RATING: 5,
  DEFAULT_PROFILE_IMAGE: 'uploads/profiles/sample.png',
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
};

/**
 * Fields that users are allowed to update in their profile
 * Used to prevent mass assignment vulnerabilities
 */
export const ALLOWED_UPDATE_FIELDS = [
  'name',
  'email',
  'faceBook',
  'instagram',
  'websiteUrl',
  'profileImage',
  'description',
  'qualifications',
  'specialisation',
  'location',
  'telephoneNumber',
  'keywords', // New array-based keywords field
  // Legacy individual keyword fields - kept for backward compatibility
  'keyWordSearchOne',
  'keyWordSearchTwo',
  'keyWordSearchThree',
  'keyWordSearchFour',
  'keyWordSearchFive',
  'specialisationOne',
  'specialisationTwo',
  'specialisationThree',
  'specialisationFour',
];

/**
 * Fields that should never be updated by users
 * Admin-only or system-managed fields
 */
export const PROTECTED_FIELDS = [
  'user',
  'rating',
  'numReviews',
  'isQualificationsVerified',
  'qualificationVerificationStatus',
  'qualificationStatusUpdatedAt',
  'reviews',
  'profileClickCounter',
  '_id',
  'createdAt',
  'updatedAt',
];
