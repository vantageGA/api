import mongoose from 'mongoose';

/**
 * Validates if a string is a valid MongoDB ObjectId
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid ObjectId
 */
export const validateObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Custom Joi validator for MongoDB ObjectId
 * @param {*} value - The value to validate
 * @param {*} helpers - Joi helpers
 * @returns {string} The validated value
 */
export const objectIdValidator = (value, helpers) => {
  if (!validateObjectId(value)) {
    return helpers.error('any.invalid');
  }
  return value;
};
