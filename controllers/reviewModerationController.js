import asyncHandler from 'express-async-handler';
import Profile from '../models/profileModel.js';
import User from '../models/userModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import { sendReviewModerationNotification, sendReviewNotification } from '../utils/emailService.js';
import { buildProfileStatsPipeline, screenReview } from '../services/reviewModerationService.js';

const queueStatuses = ['pending_review', 'under_moderation'];

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const refreshProfileStats = (profileId) =>
  Profile.updateOne({ _id: profileId }, buildProfileStatsPipeline());

const findReview = async (profileId, reviewId) => {
  const profile = await Profile.findById(profileId).select('name user reviews');
  const review = profile?.reviews.id(reviewId);
  return { profile, review };
};

export const getModerationReviews = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 25;
  const match = {};

  if (req.query.status === 'published') {
    match.$or = [
      { 'reviews.status': 'published' },
      { 'reviews.status': { $exists: false } },
    ];
  } else {
    match['reviews.status'] = req.query.status || { $in: queueStatuses };
  }
  if (req.query.riskLevel) match['reviews.screening.riskLevel'] = req.query.riskLevel;

  if (req.query.search) {
    const search = new RegExp(escapeRegex(req.query.search.trim()), 'i');
    match.$and = [{
      $or: [
        { 'reviews.name': search },
        { 'reviews.comment': search },
        { name: search },
      ],
    }];
  }

  const [result] = await Profile.aggregate([
    { $match: { $and: [{ 'reviews.0': { $exists: true } }, match] } },
    { $unwind: '$reviews' },
    { $match: match },
    { $sort: { 'reviews.createdAt': -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'reviews.moderatedBy',
        foreignField: '_id',
        as: 'moderator',
      },
    },
    {
      $project: {
        _id: 0,
        reviewId: '$reviews._id',
        profileId: '$_id',
        professionalId: '$user',
        professionalName: '$name',
        submissionDate: '$reviews.createdAt',
        moderatorName: { $ifNull: [{ $arrayElemAt: ['$moderator.name', 0] }, null] },
        user: '$reviews.user',
        name: '$reviews.name',
        rating: '$reviews.rating',
        comment: '$reviews.comment',
        showName: '$reviews.showName',
        status: '$reviews.status',
        screening: '$reviews.screening',
        rejectionReason: '$reviews.rejectionReason',
        amendmentMessage: '$reviews.amendmentMessage',
        moderatedAt: '$reviews.moderatedAt',
        publishedAt: '$reviews.publishedAt',
        moderationHistory: '$reviews.moderationHistory',
      },
    },
    {
      $facet: {
        reviews: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        metadata: [{ $count: 'total' }],
      },
    },
  ]);

  const total = result?.metadata?.[0]?.total || 0;
  res.json({
    reviews: result?.reviews || [],
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
});

export const transitionReview = async ({ profileId, reviewId, action, reason, moderatorId }) => {
  const now = new Date();
  const transitionByAction = {
    approve: {
      status: 'published',
      allowed: queueStatuses,
      history: [
        { action: 'approved', fromStatus: null, toStatus: 'approved', reason: reason || null, actor: moderatorId, createdAt: now },
        { action: 'published', fromStatus: 'approved', toStatus: 'published', actor: moderatorId, createdAt: now },
      ],
    },
    reject: {
      status: 'rejected', allowed: queueStatuses,
      history: [{ action: 'rejected', fromStatus: null, toStatus: 'rejected', reason, actor: moderatorId, createdAt: now }],
    },
    request_amendment: {
      status: 'amendment_requested', allowed: queueStatuses,
      history: [{ action: 'amendment_requested', fromStatus: null, toStatus: 'amendment_requested', reason, actor: moderatorId, createdAt: now }],
    },
    remove: {
      status: 'removed', allowed: ['published', null],
      history: [{ action: 'removed', fromStatus: 'published', toStatus: 'removed', reason, actor: moderatorId, createdAt: now }],
    },
  };
  const transition = transitionByAction[action];

  const existing = await Profile.findOne(
    { _id: profileId, 'reviews._id': reviewId },
    { reviews: { $elemMatch: { _id: reviewId } } },
  ).lean();
  const storedStatus = existing?.reviews?.[0]?.status;
  const fromStatus = action === 'remove' && storedStatus == null ? 'published' : storedStatus;
  if (!existing) {
    const error = new Error('Review not found'); error.statusCode = 404; throw error;
  }
  if (!transition.allowed.includes(storedStatus ?? null)) {
    const error = new Error('This review is no longer eligible for that moderation action');
    error.statusCode = 409; throw error;
  }
  transition.history[0].fromStatus = fromStatus;

  const update = {
    $set: {
      'reviews.$[review].status': transition.status,
      'reviews.$[review].moderatedAt': now,
      'reviews.$[review].moderatedBy': moderatorId,
      'reviews.$[review].rejectionReason': ['reject', 'remove'].includes(action) ? reason : null,
      'reviews.$[review].amendmentMessage': action === 'request_amendment' ? reason : null,
    },
    $push: { 'reviews.$[review].moderationHistory': { $each: transition.history } },
  };
  if (action === 'approve') update.$set['reviews.$[review].publishedAt'] = now;

  const result = await Profile.updateOne(
    { _id: profileId },
    update,
    { arrayFilters: [{ 'review._id': reviewId, 'review.status': { $in: transition.allowed } }] },
  );
  if (result.modifiedCount !== 1) {
    const error = new Error('The review changed while it was being moderated. Refresh and try again.');
    error.statusCode = 409; throw error;
  }

  await refreshProfileStats(profileId);
  return findReview(profileId, reviewId);
};

const sendDecisionNotification = ({ action, profile, review, reason }) => {
  if (action === 'approve') {
    User.findById(profile.user).select('email name').then((owner) => {
      if (owner?.email) return sendReviewNotification(owner.email, owner.name, review.name, review.comment);
      return null;
    }).catch((error) => console.error('Failed to send review notification:', error.message));
  }
  if (action === 'reject' || action === 'request_amendment') {
    UserReviewer.findById(review.user).select('email name').then((reviewer) => {
      if (reviewer?.email) {
        return sendReviewModerationNotification(
          reviewer.email,
          reviewer.name,
          action === 'reject' ? 'rejected' : 'amendment_requested',
          reason,
          action === 'request_amendment'
            ? `${process.env.FRONTEND_URL || 'https://www.bodyvantage.co.uk'}/reviewer-login`
            : '',
        );
      }
      return null;
    }).catch((error) => console.error('Failed to send moderation notification:', error.message));
  }
};

export const moderateReview = asyncHandler(async (req, res) => {
  try {
    const { profile, review } = await transitionReview({
      profileId: req.params.profileId,
      reviewId: req.params.reviewId,
      action: req.body.action,
      reason: req.body.reason,
      moderatorId: req.user._id,
    });
    sendDecisionNotification({ action: req.body.action, profile, review, reason: req.body.reason });
    res.json({ message: 'Moderation action recorded', review });
  } catch (error) {
    if (error.statusCode) res.status(error.statusCode);
    throw error;
  }
});

export const bulkApproveReviews = asyncHandler(async (req, res) => {
  const results = [];
  for (const item of req.body.reviews) {
    try {
      const current = await findReview(item.profileId, item.reviewId);
      if (current.review?.screening?.riskLevel !== 'low') {
        results.push({ ...item, approved: false, reason: 'Review is not low-risk' });
        continue;
      }
      const approved = await transitionReview({ ...item, action: 'approve', reason: '', moderatorId: req.user._id });
      sendDecisionNotification({ action: 'approve', ...approved, reason: '' });
      results.push({ ...item, approved: true });
    } catch (error) {
      results.push({ ...item, approved: false, reason: error.message });
    }
  }
  const approved = results.filter((result) => result.approved).length;
  res.status(approved === results.length ? 200 : 207).json({ results, approved });
});

export const amendReview = asyncHandler(async (req, res) => {
  const { profile, review } = await findReview(req.params.profileId, req.params.reviewId);
  if (!profile || !review) { res.status(404); throw new Error('Review not found'); }
  if (review.user?.toString() !== req.reviewer._id.toString()) {
    res.status(403); throw new Error('You can only amend your own review');
  }
  if (review.status !== 'amendment_requested') {
    res.status(409); throw new Error('This review is not awaiting amendment');
  }

  const screening = screenReview(
    req.body.comment,
    profile.reviews.filter((item) => item._id.toString() !== review._id.toString()).map((item) => item.comment),
  );
  const nextStatus = screening.flags.length ? 'under_moderation' : 'pending_review';
  const result = await Profile.updateOne(
    { _id: profile._id },
    {
      $set: {
        'reviews.$[review].comment': req.body.comment,
        'reviews.$[review].screening': screening,
        'reviews.$[review].status': nextStatus,
        'reviews.$[review].amendmentMessage': null,
        'reviews.$[review].moderatedAt': null,
        'reviews.$[review].moderatedBy': null,
      },
      $push: {
        'reviews.$[review].moderationHistory': {
          action: 'submitted', fromStatus: 'amendment_requested', toStatus: nextStatus,
          reason: 'Amended review resubmitted', createdAt: new Date(),
        },
      },
    },
    { arrayFilters: [{ 'review._id': review._id, 'review.status': 'amendment_requested', 'review.user': req.reviewer._id }] },
  );
  if (result.modifiedCount !== 1) {
    res.status(409); throw new Error('The review changed before it could be resubmitted');
  }
  res.json({ message: 'Amended review resubmitted for moderation', status: nextStatus });
});

export const getReviewerReviews = asyncHandler(async (req, res) => {
  const profiles = await Profile.find({ 'reviews.user': req.reviewer._id }).select('name reviews').lean();
  const reviews = profiles.flatMap((profile) => profile.reviews
    .filter((review) => review.user?.toString() === req.reviewer._id.toString())
    .map((review) => ({ ...review, profileId: profile._id, professionalName: profile.name })));
  reviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(reviews);
});

export const removeReviewWithAudit = asyncHandler(async (req, res) => {
  try {
    await transitionReview({
      profileId: req.params.id,
      reviewId: req.body.reviewId,
      action: 'remove',
      reason: req.body.reason,
      moderatorId: req.user._id,
    });
    res.json({ message: 'Published review removed and audit history retained' });
  } catch (error) {
    if (error.statusCode) res.status(error.statusCode);
    throw error;
  }
});
