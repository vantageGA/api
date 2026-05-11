import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createCheckoutSession,
  createSubscription,
  isStripePriceConfigurationError
} from '../services/stripeService.js';
import User from '../models/userModel.js';
import { generateEmailVerificationToken } from '../utils/generateToken.js';
import { sendVerificationEmail } from '../services/emailService.js';
import { logSecurityEvent, SecurityEvents, logError } from '../utils/auditLogger.js';
import { checkoutLimiter } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.post('/checkout-session', checkoutLimiter, async (req, res) => {
  try {
    const { plan, email, name, password } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (user) {
      // User already exists - check their status
      if (user.isSubscribed) {
        // Already has active subscription
        return res.status(400).json({
          error: 'You already have an active subscription. Please login to manage your account.'
        });
      }

      if (user.isConfirmed) {
        // Account exists and is confirmed, but not subscribed - direct to login
        return res.status(400).json({
          error: 'An account with this email already exists. Please login to subscribe.'
        });
      }

      // User exists but not confirmed - this is a retry, allow them to proceed
      // (verification email will be resent below)
    } else {
      // New user - validate and create
      if (!password) {
        return res.status(400).json({ error: 'Password is required to create a new user' });
      }

      // Note: Password is passed unhashed - the User model's pre-save hook handles hashing
      user = new User({
        name,
        email,
        password,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        isSubscribed: false,
        plan: null,
        currentPeriodEnd: null,
        paymentStatus: 'active'
      });

      await user.save();
      isNewUser = true;
    }

    // Send verification email to new users OR existing unconfirmed users
    if (isNewUser || !user.isConfirmed) {
      try {
        const verificationToken = generateEmailVerificationToken(user._id);
        await sendVerificationEmail(user, verificationToken);

        if (isNewUser) {
          logSecurityEvent(SecurityEvents.REGISTRATION_SUCCESS, user._id, {
            ip: req.ip,
            userAgent: req.get('user-agent'),
            source: 'stripe-checkout'
          });
        }
      } catch (emailError) {
        logError('Failed to send verification email during Stripe checkout', emailError, {
          userId: user._id,
          email: user.email
        });
      }
    }

    const session = await createCheckoutSession(user, plan);
    res.json({ url: session.url });
  } catch (error) {
    const isPriceConfigError = isStripePriceConfigurationError(error);
    const statusCode = isPriceConfigError ? 503 : 500;

    logError('Checkout session error', error, {
      plan: req.body?.plan,
      email: req.body?.email,
      stripeType: error.type,
      stripeCode: error.code,
      stripeParam: error.param,
      context: error.context
    });

    res.status(statusCode).json({
      error: isPriceConfigError
        ? 'Subscription checkout is temporarily unavailable. Please try again later.'
        : 'Unable to start checkout. Please try again later.'
    });
  }
});

router.post('/create-subscription', protect, async (req, res) => {
  try {
    const { plan, paymentMethodId } = req.body;
    const subscription = await createSubscription(req.user, plan, paymentMethodId);
    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret
    });
  } catch (error) {
    const isPriceConfigError = isStripePriceConfigurationError(error);

    logError('Create subscription error', error, {
      userId: req.user?._id,
      plan: req.body?.plan,
      stripeType: error.type,
      stripeCode: error.code,
      stripeParam: error.param,
      context: error.context
    });

    res.status(isPriceConfigError ? 503 : 500).json({
      error: isPriceConfigError
        ? 'Subscription checkout is temporarily unavailable. Please try again later.'
        : 'Unable to create subscription. Please try again later.'
    });
  }
});

export default router;
