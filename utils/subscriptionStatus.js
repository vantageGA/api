export const ACTIVE_STRIPE_STATUSES = new Set(['active', 'trialing']);

export const LEGACY_COMPATIBLE_PAYMENT_STATUSES = new Set(['pending']);

export const INACTIVE_STRIPE_STATUSES = new Set([
  'canceled',
  'failed',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'unpaid',
]);

export const isAllowedSubscribedPaymentStatus = (status) => {
  if (!status) {
    return true;
  }

  return (
    ACTIVE_STRIPE_STATUSES.has(status) ||
    LEGACY_COMPATIBLE_PAYMENT_STATUSES.has(status)
  );
};
