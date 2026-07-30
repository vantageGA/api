import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminQualificationStatusCondition,
  hasReviewerAlreadyReviewed,
} from '../controllers/profileController.js';
import { getMemberDeletionBillingState } from '../services/accountDeletionService.js';
import {
  deduplicateCloudinaryAssets,
  destroyCloudinaryAssets,
} from '../utils/cloudinaryAssetCleanup.js';
import Profile from '../models/profileModel.js';
import UserReviewer from '../models/userReviewerModel.js';

test('anonymised reviews do not break duplicate-review detection', () => {
  const reviewerId = '507f1f77bcf86cd799439011';
  const reviews = [
    { user: null },
    { user: { toString: () => reviewerId } },
  ];

  assert.equal(hasReviewerAlreadyReviewed(reviews, reviewerId), true);
  assert.equal(
    hasReviewerAlreadyReviewed([{ user: null }], reviewerId),
    false,
  );
});

test('Cloudinary cleanup deduplicates public ids and tries fallback resource types', async () => {
  const calls = [];
  const cloudinaryClient = {
    uploader: {
      async destroy(publicId, options) {
        calls.push([publicId, options.resource_type]);
        return {
          result: options.resource_type === 'raw' ? 'not found' : 'ok',
        };
      },
    },
  };
  const assets = [
    {
      publicId: 'qualification-one',
      resourceTypes: ['raw', 'image'],
    },
    {
      publicId: 'qualification-one',
      resourceTypes: ['image'],
    },
  ];

  assert.deepEqual(deduplicateCloudinaryAssets(assets), [
    {
      publicId: 'qualification-one',
      resourceTypes: ['raw', 'image'],
    },
  ]);
  assert.equal(
    await destroyCloudinaryAssets(assets, {
      cloudinaryClient,
      onError: () => assert.fail('cleanup should have succeeded'),
    }),
    1,
  );
  assert.deepEqual(calls, [
    ['qualification-one', 'raw'],
    ['qualification-one', 'image'],
  ]);
});

test('Cloudinary not-found responses are not counted as deleted assets', async () => {
  let reportedFailure;
  const deletedCount = await destroyCloudinaryAssets(
    [{ publicId: 'missing-asset', resourceTypes: ['raw', 'image'] }],
    {
      cloudinaryClient: {
        uploader: {
          async destroy() {
            return { result: 'not found' };
          },
        },
      },
      onError(message, error, context) {
        reportedFailure = { message, error, context };
      },
    },
  );

  assert.equal(deletedCount, 0);
  assert.match(reportedFailure.error.message, /all resource types/i);
  assert.equal(reportedFailure.context.failures.length, 2);
});

test('member deletion billing check blocks live Stripe subscriptions', async () => {
  const stripeClient = {
    __isConfigured: true,
    subscriptions: {
      async list() {
        return {
          data: [{ id: 'sub_live', status: 'trialing' }],
        };
      },
      async retrieve() {
        assert.fail('listed subscription should not be retrieved twice');
      },
    },
  };

  assert.deepEqual(
    await getMemberDeletionBillingState(
      {
        stripeCustomerId: 'cus_member',
        stripeSubscriptionId: 'sub_live',
      },
      stripeClient,
    ),
    {
      canDelete: false,
      reason: 'active-stripe-subscription',
    },
  );
});

test('member deletion billing check allows only confirmed inactive Stripe state', async () => {
  const stripeClient = {
    __isConfigured: true,
    subscriptions: {
      async retrieve() {
        return { id: 'sub_closed', status: 'canceled' };
      },
    },
  };

  assert.deepEqual(
    await getMemberDeletionBillingState(
      { stripeSubscriptionId: 'sub_closed', isSubscribed: true },
      stripeClient,
    ),
    { canDelete: true, reason: null },
  );
  assert.deepEqual(
    await getMemberDeletionBillingState({ isSubscribed: true }, stripeClient),
    {
      canDelete: false,
      reason: 'local-active-subscription-without-stripe-reference',
    },
  );
  assert.deepEqual(
    await getMemberDeletionBillingState(
      { isSubscribed: false, paymentStatus: 'active' },
      stripeClient,
    ),
    {
      canDelete: false,
      reason: 'local-active-subscription-without-stripe-reference',
    },
  );
});

test('admin qualification filters retain legacy approved and unverified profiles', () => {
  const approved = buildAdminQualificationStatusCondition('approved');
  const none = buildAdminQualificationStatusCondition('none');

  assert.equal(approved.$or[0].qualificationVerificationStatus, 'approved');
  assert.equal(approved.$or[1].isQualificationsVerified, true);
  assert.deepEqual(
    approved.$or[1].qualificationVerificationStatus,
    { $exists: false },
  );
  assert.equal(none.$or[0].qualificationVerificationStatus, 'none');
  assert.deepEqual(none.$or[1].isQualificationsVerified, { $ne: true });
  assert.deepEqual(buildAdminQualificationStatusCondition('pending'), {
    qualificationVerificationStatus: 'pending',
  });
});

test('profile and reviewer models expose lifecycle guards without leaking reviewer state', () => {
  assert.deepEqual(Profile.schema.path('lifecycleStatus').options.enum, [
    'active',
    'deleting',
  ]);
  assert.equal(Profile.schema.path('lifecycleStatus').options.default, 'active');
  assert.equal(UserReviewer.schema.path('deletionPending').options.select, false);
});
