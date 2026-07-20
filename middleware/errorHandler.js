/**
 * Centralized error handling middleware.
 * Must be registered AFTER all routes in server.js.
 */
const errorHandler = (err, req, res, _next) => {
  const isReviewUpload = req.originalUrl?.includes('/reviews');
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File size exceeds the allowed limit' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      message: isReviewUpload ? 'Upload no more than five review photos' : 'Too many files were uploaded',
    });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: isReviewUpload ? 'The review photo upload is invalid' : 'The file upload is invalid',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // PostgreSQL unique-violation
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Duplicate entry — resource already exists' });
  }

  // PostgreSQL foreign-key violation
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Referenced resource does not exist' });
  }

  // Generic / unhandled
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
