const asPlainObject = (reviewer) => {
  if (!reviewer) return null;
  return typeof reviewer.toObject === 'function'
    ? reviewer.toObject()
    : reviewer;
};

export const serializeReviewer = (reviewer) => {
  const value = asPlainObject(reviewer);
  if (!value) return null;

  return {
    _id: value._id,
    name: value.name,
    email: value.email,
    isConfirmed: value.isConfirmed === true,
    hasSubmittedReview: value.hasSubmittedReview === true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

export const serializeReviewers = (reviewers = []) =>
  reviewers.map(serializeReviewer).filter(Boolean);
