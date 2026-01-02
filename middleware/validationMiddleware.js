/**
 * Validation middleware factory
 * Creates middleware that validates request data against a Joi schema
 * @param {Object} schema - Joi schema to validate against
 * @param {string} property - Request property to validate ('body', 'params', 'query')
 * @returns {Function} Express middleware function
 */
export const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Return all errors, not just the first one
      stripUnknown: true, // Remove unknown properties
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);

      // Log validation errors in development for easier debugging
      if (process.env.NODE_ENV !== 'production') {
        console.error('Validation Error:', {
          property,
          errors,
          receivedData: req[property],
        });
      }

      res.status(400);
      throw new Error(errors.join(', '));
    }

    // Replace request data with sanitized values
    req[property] = value;
    next();
  };
};
