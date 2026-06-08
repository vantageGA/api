import test from 'node:test';
import assert from 'node:assert/strict';
import { syncUserSubscriptionFromStripe } from '../services/subscriptionStatusService.js';

test('syncUserSubscriptionFromStripe activates a stale DB user when Stripe has an active subscription', async () => {
  let saveCount = 0;
  const user = {
    _id: 'user-1',
    isSubscribed: false,
    paymentStatus: 'pending',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: null,
    plan: null,
    currentPeriodEnd: null,
    async save() {
      saveCount += 1;
    },
  };
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const stripeClient = {
    subscriptions: {
      async list() {
        return {
          data: [
            {
              id: 'sub_123',
              status: 'active',
              customer: 'cus_123',
              current_period_end: periodEnd,
              items: {
                data: [{ price: { id: 'price_monthly' } }],
              },
            },
          ],
        };
      },
    },
  };

  const syncedUser = await syncUserSubscriptionFromStripe(user, stripeClient);

  assert.equal(syncedUser.isSubscribed, true);
  assert.equal(syncedUser.paymentStatus, 'active');
  assert.equal(syncedUser.stripeSubscriptionId, 'sub_123');
  assert.equal(syncedUser.plan, 'price_monthly');
  assert.ok(syncedUser.currentPeriodEnd instanceof Date);
  assert.equal(saveCount, 1);
});

test('syncUserSubscriptionFromStripe leaves users without Stripe IDs unchanged', async () => {
  let saveCount = 0;
  const user = {
    _id: 'user-2',
    isSubscribed: false,
    paymentStatus: 'pending',
    async save() {
      saveCount += 1;
    },
  };

  const syncedUser = await syncUserSubscriptionFromStripe(user, {
    subscriptions: {
      async list() {
        throw new Error('should not be called');
      },
    },
  });

  assert.equal(syncedUser, user);
  assert.equal(saveCount, 0);
});

test('syncUserSubscriptionFromStripe falls back to subscription retrieve when customer listing fails', async () => {
  let saveCount = 0;
  const user = {
    _id: 'user-3',
    isSubscribed: false,
    paymentStatus: 'pending',
    stripeCustomerId: 'stale-customer-id',
    stripeSubscriptionId: 'sub_456',
    async save() {
      saveCount += 1;
    },
  };
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const stripeClient = {
    subscriptions: {
      async list() {
        throw new Error('No such customer');
      },
      async retrieve(subscriptionId) {
        assert.equal(subscriptionId, 'sub_456');
        return {
          id: 'sub_456',
          status: 'active',
          customer: 'cus_456',
          current_period_end: periodEnd,
          items: {
            data: [{ price: { id: 'price_annual' } }],
          },
        };
      },
    },
  };

  const syncedUser = await syncUserSubscriptionFromStripe(user, stripeClient);

  assert.equal(syncedUser.isSubscribed, true);
  assert.equal(syncedUser.paymentStatus, 'active');
  assert.equal(syncedUser.stripeCustomerId, 'cus_456');
  assert.equal(syncedUser.plan, 'price_annual');
  assert.equal(saveCount, 1);
});
