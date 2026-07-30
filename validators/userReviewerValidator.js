import Joi from 'joi';
import { objectIdValidator } from './commonValidators.js';

export const reviewerIdSchema = Joi.object({
  id: Joi.string()
    .custom(objectIdValidator)
    .required()
    .messages({
      'any.invalid': 'Invalid reviewer ID format',
      'any.required': 'Reviewer ID is required',
    }),
});

export const adminReviewerListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    'number.min': 'Page must be at least 1',
  }),
  limit: Joi.number().integer().min(1).max(100).default(25).messages({
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit must not exceed 100',
  }),
  search: Joi.string().trim().max(200).allow('').default('').messages({
    'string.max': 'Search must not exceed 200 characters',
  }),
  isConfirmed: Joi.boolean(),
  hasSubmittedReview: Joi.boolean(),
});
