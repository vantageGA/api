export const ACTIVE_PAYMENT_STATUSES = ['active', 'trialing', 'pending'];

export const buildActivePaidMemberQuery = (asOf = new Date()) => ({
  isAdmin: { $ne: true },
  isConfirmed: true,
  isSubscribed: true,
  $and: [
    {
      $or: [
        { paymentStatus: { $in: ACTIVE_PAYMENT_STATUSES } },
        { paymentStatus: null },
        { paymentStatus: { $exists: false } },
      ],
    },
    {
      $or: [
        { currentPeriodEnd: { $gt: asOf } },
        { currentPeriodEnd: null },
        { currentPeriodEnd: { $exists: false } },
      ],
    },
  ],
});
