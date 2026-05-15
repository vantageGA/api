import Joi from 'joi';

const passwordSpecialCharacters = '@$!%*?&-';
const passwordRequirementMessage = `Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (${passwordSpecialCharacters})`;

// Password validation pattern. Keep this aligned with client/src/utils/validation.js.
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&-])[A-Za-z\d@$!%*?&-]{8,128}$/;

// User registration validation schema
export const registerSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .pattern(/^[a-zA-Z\s'-]+$/)
    .messages({
      'string.pattern.base': 'Name can only contain letters, spaces, hyphens, and apostrophes',
      'string.min': 'Name must be at least 2 characters long',
      'string.max': 'Name cannot exceed 100 characters',
      'any.required': 'Name is required'
    }),
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .required()
    .max(255)
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.max': 'Email cannot exceed 255 characters',
      'any.required': 'Email is required'
    }),
  password: Joi.string()
    .min(8)
    .max(128)
    .required()
    .pattern(passwordPattern)
    .messages({
      'string.pattern.base': passwordRequirementMessage,
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password cannot exceed 128 characters',
      'any.required': 'Password is required'
    })
});

export const checkoutSessionSchema = Joi.object({
  plan: Joi.string()
    .valid('monthly', 'annual')
    .required()
    .messages({
      'any.only': 'Plan must be monthly or annual',
      'any.required': 'Plan is required'
    }),
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .required()
    .max(255)
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.max': 'Email cannot exceed 255 characters',
      'any.required': 'Email is required'
    })
});

// User login validation schema
export const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  password: Joi.string()
    .required()
    .messages({
      'any.required': 'Password is required'
    })
});

// User profile update validation schema
export const updateProfileSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z\s'-]+$/)
    .messages({
      'string.pattern.base': 'Name can only contain letters, spaces, hyphens, and apostrophes',
      'string.min': 'Name must be at least 2 characters long',
      'string.max': 'Name cannot exceed 100 characters'
    }),
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .max(255)
    .messages({
      'string.email': 'Please provide a valid email address',
      'string.max': 'Email cannot exceed 255 characters'
    }),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(passwordPattern)
    .messages({
      'string.pattern.base': passwordRequirementMessage,
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password cannot exceed 128 characters'
    }),
  currentPassword: Joi.string()
    .when('password', {
      is: Joi.exist(),
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'any.required': 'Current password is required to change password'
    })
});

// Forgot password validation schema
export const forgotPasswordSchema = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .trim()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    })
});

// Reset password validation schema
export const resetPasswordSchema = Joi.object({
  resetPasswordToken: Joi.string()
    .required()
    .messages({
      'any.required': 'Reset token is required'
    }),
  password: Joi.string()
    .min(8)
    .max(128)
    .required()
    .pattern(passwordPattern)
    .messages({
      'string.pattern.base': passwordRequirementMessage,
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password cannot exceed 128 characters',
      'any.required': 'Password is required'
    })
});

// Update admin status validation schema
export const updateIsAdminSchema = Joi.object({
  val: Joi.boolean()
    .required()
    .messages({
      'boolean.base': 'isAdmin update requires a boolean value',
      'any.required': 'isAdmin value is required'
    })
});

// MongoDB ObjectId validation helper
export const validateObjectId = (id) => {
  const objectIdPattern = /^[0-9a-fA-F]{24}$/;
  return objectIdPattern.test(id);
};
