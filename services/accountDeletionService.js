import stripe from '../config/stripe.js';
import { ACTIVE_STRIPE_STATUSES } from '../utils/subscriptionStatus.js';

const getSubscriptionsForDeletionCheck = async (user, stripeClient) => {
  const subscriptions = [];

  if (user.stripeCustomerId) {
    const responses = await Promise.all(
      [...ACTIVE_STRIPE_STATUSES].map((status) =>
        stripeClient.subscriptions.list({
          customer: user.stripeCustomerId,
          status,
          limit: 1,
        }),
      ),
    );
    for (const response of responses) {
      subscriptions.push(...(response.data || []));
    }
  }

  if (
    user.stripeSubscriptionId &&
    !subscriptions.some(
      (subscription) => subscription.id === user.stripeSubscriptionId,
    )
  ) {
    subscriptions.push(
      await stripeClient.subscriptions.retrieve(user.stripeSubscriptionId),
    );
  }

  return subscriptions.filter(Boolean);
};

export const getMemberDeletionBillingState = async (
  user,
  stripeClient = stripe,
) => {
  const hasStripeReference = Boolean(
    user?.stripeCustomerId || user?.stripeSubscriptionId,
  );

  if (!hasStripeReference) {
    const hasUnreconciledActiveBilling =
      user?.isSubscribed === true ||
      ACTIVE_STRIPE_STATUSES.has(user?.paymentStatus);

    return {
      canDelete: !hasUnreconciledActiveBilling,
      reason:
        hasUnreconciledActiveBilling
          ? 'local-active-subscription-without-stripe-reference'
          : null,
    };
  }

  const canListCustomerSubscriptions =
    !user.stripeCustomerId ||
    typeof stripeClient?.subscriptions?.list === 'function';
  const canRetrieveStoredSubscription =
    !user.stripeSubscriptionId ||
    typeof stripeClient?.subscriptions?.retrieve === 'function';

  if (
    stripeClient?.__isConfigured === false ||
    !canListCustomerSubscriptions ||
    !canRetrieveStoredSubscription
  ) {
    return {
      canDelete: false,
      reason: 'stripe-verification-unavailable',
    };
  }

  const subscriptions = await getSubscriptionsForDeletionCheck(
    user,
    stripeClient,
  );
  const blockingSubscription = subscriptions.find((subscription) =>
    ACTIVE_STRIPE_STATUSES.has(subscription.status),
  );

  return {
    canDelete: !blockingSubscription,
    reason: blockingSubscription ? 'active-stripe-subscription' : null,
  };
};
