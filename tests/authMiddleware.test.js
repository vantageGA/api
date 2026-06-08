import test from 'node:test';
import assert from 'node:assert/strict';
import { hasActiveSubscription, requireActiveSubscription } from '../middleware/authMiddleware.js';

test('hasActiveSubscription rejects verified users who have not paid', () => {
  assert.equal(
    hasActiveSubscription({
      isAdmin: false,
      isSubscribed: false,
      paymentStatus: 'pending',
    }),
    false,
  );
});

test('hasActiveSubscription accepts active paid users', () => {
  assert.equal(
    hasActiveSubscription({
      isAdmin: false,
      isSubscribed: true,
      paymentStatus: 'active',
      currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
    }),
    true,
  );
});

test('hasActiveSubscription rejects expired paid users', () => {
  assert.equal(
    hasActiveSubscription({
      isAdmin: false,
      isSubscribed: true,
      paymentStatus: 'active',
      currentPeriodEnd: new Date(Date.now() - 60 * 60 * 1000),
    }),
    false,
  );
});

test('hasActiveSubscription accepts legacy paid users with pending payment status', () => {
  assert.equal(
    hasActiveSubscription({
      isAdmin: false,
      isSubscribed: true,
      paymentStatus: 'pending',
      currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
    }),
    true,
  );
});

test('hasActiveSubscription rejects failed subscribers who still have isSubscribed true', () => {
  assert.equal(
    hasActiveSubscription({
      isAdmin: false,
      isSubscribed: true,
      paymentStatus: 'failed',
      currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
    }),
    false,
  );
});

test('hasActiveSubscription rejects canceled subscribers who still have isSubscribed true', () => {
  assert.equal(
    hasActiveSubscription({
      isAdmin: false,
      isSubscribed: true,
      paymentStatus: 'canceled',
      currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
    }),
    false,
  );
});

test('hasActiveSubscription rejects inactive Stripe statuses even when isSubscribed is true', () => {
  for (const paymentStatus of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(
      hasActiveSubscription({
        isAdmin: false,
        isSubscribed: true,
        paymentStatus,
        currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
      }),
      false,
      `${paymentStatus} should not grant subscription access`,
    );
  }
});

test('requireActiveSubscription responds with 402 for unpaid users', () => {
  const req = {
    user: {
      isAdmin: false,
      isSubscribed: false,
      paymentStatus: 'pending',
    },
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  const next = () => {
    throw new Error('next should not be called');
  };

  assert.throws(
    () => requireActiveSubscription(req, res, next),
    /active subscription is required/,
  );
  assert.equal(res.statusCode, 402);
});
