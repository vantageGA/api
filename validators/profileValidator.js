import Joi from 'joi';
import { objectIdValidator } from './commonValidators.js';

export const profileIdSchema = Joi.object({
  id: Joi.string()
    .custom(objectIdValidator)
    .required()
    .messages({
      'any.invalid': 'Invalid profile ID format',
      'any.required': 'Profile ID is required',
    }),
});

export const updateClicksSchema = Joi.object({
  _id: Joi.string()
    .custom(objectIdValidator)
    .required()
    .messages({
      'any.invalid': 'Invalid profile ID format',
      'any.required': 'Profile ID is required',
    }),
  // Server will control increment, but validate if sent
  profileClickCounter: Joi.number().integer().min(0).max(1).optional(),
});

export const createReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required().messages({
    'number.min': 'Rating must be between 1 and 5',
    'number.max': 'Rating must be between 1 and 5',
    'any.required': 'Rating is required',
  }),
  comment: Joi.string()
    .trim()
    .min(10)
    .max(1000)
    .required()
    .messages({
      'string.min': 'Comment must be at least 10 characters',
      'string.max': 'Comment must not exceed 1000 characters',
      'any.required': 'Comment is required',
    }),
  showName: Joi.boolean().required().messages({
    'any.required': 'showName is required',
  }),
  userProfileId: Joi.string()
    .custom(objectIdValidator)
    .required()
    .messages({
      'any.invalid': 'Invalid user profile ID format',
      'any.required': 'User profile ID is required',
    }),
  acceptConditions: Joi.boolean().valid(true).required().messages({
    'any.only': 'You must accept the review conditions',
    'any.required': 'You must accept the review conditions',
  }),
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).allow('').messages({
    'string.min': 'Name must be at least 2 characters',
    'string.max': 'Name must not exceed 100 characters',
  }),
  email: Joi.string().email().max(255).allow('').messages({
    'string.email': 'Please provide a valid email address',
    'string.max': 'Email must not exceed 255 characters',
  }),
  faceBook: Joi.string().max(500).allow('').messages({
    'string.max': 'Facebook URL must not exceed 500 characters',
  }),
  instagram: Joi.string().max(500).allow('').messages({
    'string.max': 'Instagram URL must not exceed 500 characters',
  }),
  websiteUrl: Joi.string().max(500).allow('').messages({
    'string.max': 'Website URL must not exceed 500 characters',
  }),
  profileImage: Joi.string().max(500).messages({
    'string.max': 'Profile image URL must not exceed 500 characters',
  }),
  description: Joi.string().max(2000).allow('').messages({
    'string.max': 'Description must not exceed 2000 characters',
  }),
  qualifications: Joi.string().max(1000).allow('').messages({
    'string.max': 'Qualifications must not exceed 1000 characters',
  }),
  specialisation: Joi.string().max(200).allow('').messages({
    'string.max': 'Specialisation must not exceed 200 characters',
  }),
  location: Joi.string().max(200).allow('').messages({
    'string.max': 'Location must not exceed 200 characters',
  }),
  telephoneNumber: Joi.string()
    .pattern(/^\+?[\d\s\-()]+$/)
    .max(20)
    .allow('')
    .messages({
      'string.pattern.base': 'Please provide a valid telephone number',
      'string.max': 'Telephone number must not exceed 20 characters',
    }),
  // New array-based keywords field for efficient searching
  keywords: Joi.array()
    .items(
      Joi.string()
        .trim()
        .min(3)
        .max(50)
        .pattern(/^[a-zA-Z0-9\s\-]+$/)
        .messages({
          'string.min': 'Each keyword must be at least 3 characters',
          'string.max': 'Each keyword must not exceed 50 characters',
          'string.pattern.base':
            'Keywords can only contain letters, numbers, spaces, and hyphens',
        }),
    )
    .max(5)
    .messages({
      'array.max': 'Maximum 5 keywords allowed',
    }),
  // Legacy individual keyword fields - kept for backward compatibility
  keyWordSearchOne: Joi.string().trim().min(3).max(50).allow('').messages({
    'string.min': 'Keyword must be at least 3 characters',
    'string.max': 'Keyword must not exceed 50 characters',
  }),
  keyWordSearchTwo: Joi.string().trim().min(3).max(50).allow('').messages({
    'string.min': 'Keyword must be at least 3 characters',
    'string.max': 'Keyword must not exceed 50 characters',
  }),
  keyWordSearchThree: Joi.string().trim().min(3).max(50).allow('').messages({
    'string.min': 'Keyword must be at least 3 characters',
    'string.max': 'Keyword must not exceed 50 characters',
  }),
  keyWordSearchFour: Joi.string().trim().min(3).max(50).allow('').messages({
    'string.min': 'Keyword must be at least 3 characters',
    'string.max': 'Keyword must not exceed 50 characters',
  }),
  keyWordSearchFive: Joi.string().trim().min(3).max(50).allow('').messages({
    'string.min': 'Keyword must be at least 3 characters',
    'string.max': 'Keyword must not exceed 50 characters',
  }),
  specialisationOne: Joi.string().max(100).allow('').messages({
    'string.max': 'Specialisation must not exceed 100 characters',
  }),
  specialisationTwo: Joi.string().max(100).allow('').messages({
    'string.max': 'Specialisation must not exceed 100 characters',
  }),
  specialisationThree: Joi.string().max(100).allow('').messages({
    'string.max': 'Specialisation must not exceed 100 characters',
  }),
  specialisationFour: Joi.string().max(100).allow('').messages({
    'string.max': 'Specialisation must not exceed 100 characters',
  }),
}).min(1).messages({
  'object.min': 'At least one field must be provided for update',
});

export const deleteReviewSchema = Joi.object({
  reviewId: Joi.string()
    .custom(objectIdValidator)
    .required()
    .messages({
      'any.invalid': 'Invalid review ID format',
      'any.required': 'Review ID is required',
    }),
});

export const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    'number.min': 'Page must be at least 1',
  }),
  limit: Joi.number().integer().min(1).max(100).default(20).messages({
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit must not exceed 100',
  }),
  location: Joi.string().max(200).allow('').messages({
    'string.max': 'Location filter must not exceed 200 characters',
  }),
  specialisation: Joi.string().max(200).allow('').messages({
    'string.max': 'Specialisation filter must not exceed 200 characters',
  }),
});
