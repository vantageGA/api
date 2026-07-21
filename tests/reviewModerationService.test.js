import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProfileStatsPipeline, screenReview } from '../services/reviewModerationService.js';
import { updateProfileStats } from '../utils/profileHelpers.js';

test('clean reviews are classified as low risk', () => {
  const result = screenReview('The treatment was professional and helped my recovery.');
  assert.equal(result.riskLevel, 'low');
  assert.deepEqual(result.flags, []);
});

test('screening detects contact details, links, and repeated content', () => {
  const comment = 'Call me on +44 7700 900123 or visit https://spam.example';
  const result = screenReview(comment, [comment]);
  assert.equal(result.riskLevel, 'high');
  assert.ok(result.flags.includes('phone_number'));
  assert.ok(result.flags.includes('external_link'));
  assert.ok(result.flags.includes('duplicate_content'));
});

test('screening detects discriminatory language, addresses, and generated spam markers', () => {
  const result = screenReview(
    'As an AI language model, here is a review. People like you should go back to your country. Visit 14 Market Street.',
  );
  assert.equal(result.riskLevel, 'high');
  assert.ok(result.flags.includes('discriminatory_content'));
  assert.ok(result.flags.includes('home_address'));
  assert.ok(result.flags.includes('suspicious_generated_spam'));
});

test('profile statistics include legacy and published reviews only', () => {
  const profile = {
    reviews: [
      { rating: 5 },
      { rating: 3, status: 'published' },
      { rating: 1, status: 'pending_review' },
      { rating: 1, status: 'rejected' },
    ],
  };
  updateProfileStats(profile);
  assert.equal(profile.numReviews, 2);
  assert.equal(profile.rating, 4);
});

test('atomic profile stats pipeline treats legacy reviews as published', () => {
  const pipeline = buildProfileStatsPipeline();
  assert.equal(pipeline.length, 3);
  assert.equal(pipeline[0].$set._publicReviewsForStats.$filter.cond.$eq[1], 'published');
});
