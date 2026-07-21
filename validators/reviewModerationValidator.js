import Joi from 'joi';
import { objectIdValidator } from './commonValidators.js';

const objectId = Joi.string().custom(objectIdValidator).required();

export const reviewModerationListSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
  status: Joi.string().valid(
    'pending_review',
    'under_moderation',
    'approved',
    'rejected',
    'amendment_requested',
    'published',
    'removed',
  ),
  riskLevel: Joi.string().valid('low', 'medium', 'high'),
  search: Joi.string().trim().max(200).allow(''),
});

export const reviewModerationParamsSchema = Joi.object({
  profileId: objectId,
  reviewId: objectId,
});

export const reviewModerationActionSchema = Joi.object({
  action: Joi.string()
    .valid('approve', 'reject', 'request_amendment', 'remove')
    .required(),
  reason: Joi.string().trim().max(1000).allow(''),
}).custom((value, helpers) => {
  if (['reject', 'request_amendment', 'remove'].includes(value.action) && !value.reason) {
    return helpers.message('A reason is required for this moderation action');
  }
  return value;
});

export const bulkApproveReviewsSchema = Joi.object({
  reviews: Joi.array()
    .items(Joi.object({ profileId: objectId, reviewId: objectId }))
    .min(1)
    .max(100)
    .required(),
});

export const amendReviewSchema = Joi.object({
  comment: Joi.string().trim().min(10).max(1000).required(),
});
