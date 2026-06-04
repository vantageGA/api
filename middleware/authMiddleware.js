import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import asyncHandler from 'express-async-handler';

const protect = asyncHandler(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');

      return next();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('JWT verification failed:', error);
      }
      res.status(401);
      throw new Error('Token has failed');
    }
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorised, no token');
  }
});

const admin = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(403);
    throw new Error('Not authorised as an ADMIN');
  }
};

const optionalProtect = asyncHandler(async (req, res, next) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Optional JWT verification failed:', error);
      }
      res.status(401);
      throw new Error('Token has failed');
    }
  }

  next();
});

const hasActiveSubscription = (user) => {
  if (!user) {
    return false;
  }

  if (user.isAdmin) {
    return true;
  }

  if (user.isSubscribed !== true) {
    return false;
  }

  if (user.paymentStatus && user.paymentStatus !== 'active') {
    return false;
  }

  if (user.currentPeriodEnd && new Date(user.currentPeriodEnd).getTime() <= Date.now()) {
    return false;
  }

  return true;
};

const requireActiveSubscription = (req, res, next) => {
  if (hasActiveSubscription(req.user)) {
    return next();
  }

  res.status(402);
  throw new Error('An active subscription is required to edit your professional profile.');
};

export { protect, optionalProtect, admin, hasActiveSubscription, requireActiveSubscription };
