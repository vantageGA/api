import Joi from 'joi';
import { objectIdValidator } from './commonValidators.js';

const QUALIFICATION_DOCUMENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
];

const QUALIFICATION_DOCUMENT_REVIEW_STATUSES = [
  'approved',
  'rejected',
];

export const qualificationDocumentIdSchema = Joi.object({
  id: Joi.string()
    .custom(objectIdValidator)
    .required()
    .messages({
      'any.invalid': 'Invalid qualification document ID format',
      'any.required': 'Qualification document ID is required',
    }),
});

export const qualificationDocumentListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    'number.min': 'Page must be at least 1',
  }),
  limit: Joi.number().integer().min(1).max(100).default(20).messages({
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit must not exceed 100',
  }),
  status: Joi.string()
    .trim()
    .valid(...QUALIFICATION_DOCUMENT_STATUSES)
    .empty('')
    .messages({
      'any.only': 'Status must be one of: pending, approved, rejected',
    }),
  isActive: Joi.boolean().messages({
    'boolean.base': 'isActive must be true or false',
  }),
});

export const qualificationDocumentReviewSchema = Joi.object({
  status: Joi.string()
    .valid(...QUALIFICATION_DOCUMENT_REVIEW_STATUSES)
    .required()
    .messages({
      'any.only': 'Status must be either approved or rejected',
      'any.required': 'Review status is required',
    }),
  rejectionReason: Joi.string()
    .trim()
    .allow('')
    .max(500)
    .default('')
    .messages({
      'string.max': 'Rejection reason must not exceed 500 characters',
    }),
}).custom((value, helpers) => {
  const rejectionReason = value.rejectionReason?.trim() || '';

  if (value.status === 'rejected' && rejectionReason.length < 10) {
    return helpers.message(
      'Rejection reason must be at least 10 characters when rejecting a document',
    );
  }

  if (value.status === 'approved' && rejectionReason.length > 0) {
    return helpers.message(
      'Rejection reason must be empty when approving a document',
    );
  }

  return {
    ...value,
    rejectionReason,
  };
}, 'qualification document review validation');
