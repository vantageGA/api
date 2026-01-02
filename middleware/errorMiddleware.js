const notFound = (req, res, next) => {
  const error = new Error(`Not found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  // Log full error server-side for debugging
  console.error({
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    statusCode,
    error: err.message,
    stack: err.stack,
    user: req.user?._id || 'unauthenticated',
    ip: req.ip,
  });

  // Determine if error is operational (expected) or programming error
  const isOperational = statusCode < 500;

  res.status(statusCode);
  res.json({
    success: false,
    message: isOperational
      ? err.message
      : 'An unexpected error occurred. Please try again later.',
    // Only include stack trace and error details in development
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      details: err,
    }),
  });
};

export { notFound, errorHandler };
