import stripe from '../config/stripe.js';
import { logError } from '../utils/auditLogger.js';
import { ACTIVE_STRIPE_STATUSES } from '../utils/subscriptionStatus.js';

const getSubscriptionCustomerId = (subscription) => {
  if (!subscription?.customer) {
    return null;
  }

  return typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
};

const applyStripeSubscriptionToUser = (user, subscription) => {
  const isActive = ACTIVE_STRIPE_STATUSES.has(subscription.status);
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const customerId = getSubscriptionCustomerId(subscription);

  user.isSubscribed = isActive;
  user.paymentStatus = isActive ? 'active' : subscription.status;
  user.stripeSubscriptionId = subscription.id || user.stripeSubscriptionId;

  if (customerId) {
    user.stripeCustomerId = customerId;
  }

  if (priceId) {
    user.plan = priceId;
  }

  if (subscription.current_period_end) {
    user.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  }
};

const getActiveSubscription = (subscriptions = []) =>
  subscriptions.find((subscription) => ACTIVE_STRIPE_STATUSES.has(subscription.status));

const listCustomerSubscriptions = async (stripeClient, customerId) => {
  if (!customerId || typeof stripeClient.subscriptions?.list !== 'function') {
    return [];
  }

  const response = await stripeClient.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  });

  return response.data || [];
};

const retrieveSubscription = async (stripeClient, subscriptionId) => {
  if (!subscriptionId || typeof stripeClient.subscriptions?.retrieve !== 'function') {
    return null;
  }

  return stripeClient.subscriptions.retrieve(subscriptionId);
};

export const syncUserSubscriptionFromStripe = async (user, stripeClient = stripe) => {
  if (!user?.stripeCustomerId && !user?.stripeSubscriptionId) {
    return user;
  }

  let subscriptions = [];

  try {
    subscriptions = await listCustomerSubscriptions(stripeClient, user.stripeCustomerId);
  } catch (error) {
    logError('Failed to list Stripe subscriptions for user', error, {
      userId: user._id,
      stripeCustomerId: user.stripeCustomerId,
    });
  }

  const activeSubscription = getActiveSubscription(subscriptions);

  if (activeSubscription) {
    applyStripeSubscriptionToUser(user, activeSubscription);
    await user.save();
    return user;
  }

  try {
    const storedSubscription = await retrieveSubscription(
      stripeClient,
      user.stripeSubscriptionId,
    );

    if (!storedSubscription) {
      return user;
    }

    applyStripeSubscriptionToUser(user, storedSubscription);
    await user.save();
  } catch (error) {
    logError('Failed to retrieve Stripe subscription for user', error, {
      userId: user._id,
      stripeSubscriptionId: user.stripeSubscriptionId,
    });
  }

  return user;
};
