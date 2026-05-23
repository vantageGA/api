import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfileDraftModel,
  isProfileDraftAIEnabled,
  normalizeProfileDraft,
} from '../services/profileDraftAIService.js';

test('normalizeProfileDraft strips disallowed fields and keeps only allowed draft data', () => {
  const result = normalizeProfileDraft({
    location: '  Manchester  ',
    telephoneNumber: ' 07123 456789 ',
    description: ' Experienced personal trainer. ',
    qualifications: 'Level 3 Personal Training',
    specialisation: 'Strength training and weight management',
    keywords: ['Strength Training', 'PT!', 'x'],
    isAdmin: true,
    qualificationVerificationStatus: 'approved',
    warnings: [' Check qualification claims. '],
  });

  assert.deepEqual(Object.keys(result.draft), [
    'location',
    'telephoneNumber',
    'websiteUrl',
    'faceBook',
    'instagram',
    'description',
    'specialisation',
    'qualifications',
    'specialisationOne',
    'specialisationTwo',
    'specialisationThree',
    'specialisationFour',
    'keywords',
  ]);
  assert.equal(result.draft.location, 'Manchester');
  assert.equal(result.draft.telephoneNumber, '07123 456789');
  assert.deepEqual(result.draft.keywords, ['strength training']);
  assert.equal(result.draft.isAdmin, undefined);
  assert.equal(result.draft.qualificationVerificationStatus, undefined);
  assert.ok(result.warnings.includes('Check qualification claims.'));
  assert.ok(
    result.warnings.includes(
      'Please verify all qualification and experience claims before saving.',
    ),
  );
});

test('normalizeProfileDraft reports missing required profile draft fields', () => {
  const result = normalizeProfileDraft({
    location: 'Leeds',
    keywords: ['fitness'],
  });

  assert.ok(result.missingFields.includes('telephoneNumber'));
  assert.ok(result.missingFields.includes('description'));
  assert.ok(result.missingFields.includes('qualifications'));
  assert.equal(result.missingFields.includes('keywords'), false);
});

test('profile draft feature helpers use safe defaults', () => {
  const previousEnabled = process.env.AI_PROFILE_DRAFT_ENABLED;
  const previousProfileDraftModel = process.env.OPENAI_PROFILE_DRAFT_MODEL;
  const previousOpenAIModel = process.env.OPENAI_MODEL;

  delete process.env.AI_PROFILE_DRAFT_ENABLED;
  delete process.env.OPENAI_PROFILE_DRAFT_MODEL;
  delete process.env.OPENAI_MODEL;

  assert.equal(isProfileDraftAIEnabled(), false);
  assert.equal(getProfileDraftModel(), 'gpt-5.5');

  process.env.OPENAI_MODEL = 'gpt-5.5';
  assert.equal(getProfileDraftModel(), 'gpt-5.5');

  process.env.OPENAI_PROFILE_DRAFT_MODEL = 'gpt-5.5-profile';
  assert.equal(getProfileDraftModel(), 'gpt-5.5-profile');

  if (previousEnabled === undefined) {
    delete process.env.AI_PROFILE_DRAFT_ENABLED;
  } else {
    process.env.AI_PROFILE_DRAFT_ENABLED = previousEnabled;
  }

  if (previousProfileDraftModel === undefined) {
    delete process.env.OPENAI_PROFILE_DRAFT_MODEL;
  } else {
    process.env.OPENAI_PROFILE_DRAFT_MODEL = previousProfileDraftModel;
  }

  if (previousOpenAIModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = previousOpenAIModel;
  }
});
