import express from 'express';
import { protect, optionalProtect, hasActiveSubscription } from '../middleware/authMiddleware.js';
import {
  createCheckoutSession,
  createSubscription,
  isStripePriceConfigurationError
} from '../services/stripeService.js';
import stripe from '../config/stripe.js';
import User from '../models/userModel.js';
import generateToken, { generateEmailVerificationToken } from '../utils/generateToken.js';
import { sendVerificationEmail } from '../services/emailService.js';
import { syncUserSubscriptionFromStripe } from '../services/subscriptionStatusService.js';
import { logSecurityEvent, SecurityEvents, logError } from '../utils/auditLogger.js';
import { checkoutLimiter } from '../middleware/rateLimitMiddleware.js';
import { checkoutSessionSchema, registerSchema } from '../validators/userValidator.js';

const router = express.Router();

const checkoutUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  isAdmin: user.isAdmin,
  isConfirmed: user.isConfirmed,
  isSubscribed: user.isSubscribed,
  plan: user.plan,
  currentPeriodEnd: user.currentPeriodEnd,
  paymentStatus: user.paymentStatus,
  token: generateToken(user._id),
});

const getStripeObjectId = (value) => {
  if (!value) {
    return null;
  }

  return typeof value === 'string' ? value : value.id;
};

router.post('/checkout-session', checkoutLimiter, optionalProtect, async (req, res) => {
  try {
    const { error, value } = checkoutSessionSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false
    });

    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { plan, email } = value;

    // Check if user already exists
    let user = await User.findOne({ email });
    let isNewUser = false;

    if (user) {
      // User already exists - check their status
      if (hasActiveSubscription(user)) {
        // Already has active subscription
        return res.status(400).json({
          error: 'You already have an active subscription. Please login to manage your account.'
        });
      }

      if (user.isConfirmed && req.user?._id?.toString() !== user._id.toString()) {
        // Account exists and is confirmed, but the request is not from that logged-in user.
        return res.status(400).json({
          error: 'An account with this email already exists. Please login to subscribe.'
        });
      }

      // User exists but not confirmed - this is a retry, allow them to proceed
      // (verification email will be resent below)
    } else {
      const { error: registrationError, value: registrationValue } = registerSchema.validate(
        { ...req.body, email },
        {
          stripUnknown: true,
          abortEarly: false
        }
      );

      if (registrationError) {
        return res.status(400).json({ error: registrationError.details[0].message });
      }

      const { name, password } = registrationValue;

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
        paymentStatus: 'pending'
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
    if (!user.isSubscribed && user.paymentStatus !== 'pending') {
      user.paymentStatus = 'pending';
      await user.save();
    }
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

router.get('/checkout-session/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const customerId = getStripeObjectId(session.customer);
    const subscriptionId = getStripeObjectId(session.subscription);

    if (!customerId) {
      return res.status(404).json({ error: 'Checkout session customer was not found.' });
    }

    const user = await User.findOne({ stripeCustomerId: customerId });

    if (!user) {
      return res.status(404).json({ error: 'Checkout session user was not found.' });
    }

    if (subscriptionId && !user.stripeSubscriptionId) {
      user.stripeSubscriptionId = subscriptionId;
    }

    const syncedUser = await syncUserSubscriptionFromStripe(user);

    res.json({ user: checkoutUserResponse(syncedUser) });
  } catch (error) {
    logError('Checkout session verification error', error, {
      sessionId: req.params.sessionId,
      stripeType: error.type,
      stripeCode: error.code,
      stripeParam: error.param,
    });

    res.status(400).json({
      error: 'Unable to verify checkout session. Please login to continue.',
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
