import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Profile from '../models/profileModel.js';
import { transitionReview } from '../controllers/reviewModerationController.js';

const profileId = new mongoose.Types.ObjectId();
const reviewId = new mongoose.Types.ObjectId();
const moderatorId = new mongoose.Types.ObjectId();

test('approval uses a conditional atomic update and records coherent audit transitions', async () => {
  const updateCalls = [];
  mock.method(Profile, 'findOne', () => ({
    lean: async () => ({ reviews: [{ status: 'pending_review' }] }),
  }));
  mock.method(Profile, 'updateOne', async (...args) => {
    updateCalls.push(args);
    return { modifiedCount: 1 };
  });
  mock.method(Profile, 'findById', () => ({
    select: async () => ({
      _id: profileId,
      reviews: { id: () => ({ _id: reviewId, status: 'published' }) },
    }),
  }));

  await transitionReview({ profileId, reviewId, action: 'approve', reason: '', moderatorId });

  const moderationUpdate = updateCalls[0][1];
  const options = updateCalls[0][2];
  assert.equal(moderationUpdate.$set['reviews.$[review].status'], 'published');
  assert.deepEqual(
    moderationUpdate.$push['reviews.$[review].moderationHistory'].$each.map((entry) => [entry.fromStatus, entry.toStatus]),
    [['pending_review', 'approved'], ['approved', 'published']],
  );
  assert.deepEqual(options.arrayFilters[0]['review.status'].$in, ['pending_review', 'under_moderation']);
  assert.ok(Array.isArray(updateCalls[1][1]), 'statistics should be refreshed with an update pipeline');

  mock.restoreAll();
});

test('a stale moderation decision fails with conflict before updating', async () => {
  mock.method(Profile, 'findOne', () => ({
    lean: async () => ({ reviews: [{ status: 'published' }] }),
  }));

  await assert.rejects(
    transitionReview({ profileId, reviewId, action: 'reject', reason: 'Not relevant', moderatorId }),
    (error) => error.statusCode === 409,
  );

  mock.restoreAll();
});
