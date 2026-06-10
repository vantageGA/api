import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profileDraftRequestSchema,
  updateProfileSchema,
} from '../validators/profileValidator.js';

test('updateProfileSchema accepts Quill HTML when visible specialisation text is within the limit', () => {
  const specialisation = `<p>${'<strong>fit</strong>'.repeat(100)}</p>`;
  const { error } = updateProfileSchema.validate({ specialisation });

  assert.equal(error, undefined);
});

test('updateProfileSchema accepts an empty profile image during profile text updates', () => {
  const { error } = updateProfileSchema.validate({
    description: '<p>Experienced trainer working across Surrey.</p>',
    profileImage: '',
  });

  assert.equal(error, undefined);
});

test('updateProfileSchema rejects specialisation when visible text exceeds the limit', () => {
  const specialisation = `<p>${'a'.repeat(401)}</p>`;
  const { error } = updateProfileSchema.validate({ specialisation });

  assert.ok(error);
  assert.match(error.message, /Specialisation must not exceed 400 characters/);
});

test('profileDraftRequestSchema accepts natural language input and allowed current profile fields', () => {
  const { error, value } = profileDraftRequestSchema.validate({
    input:
      'I am a Level 3 personal trainer in Manchester specialising in strength training and weight management.',
    currentProfile: {
      location: 'Manchester',
      telephoneNumber: '07123456789',
      isAdmin: true,
    },
  }, { stripUnknown: true });

  assert.equal(error, undefined);
  assert.equal(value.currentProfile.location, 'Manchester');
  assert.equal(value.currentProfile.telephoneNumber, '07123456789');
  assert.equal(value.currentProfile.isAdmin, undefined);
});

test('profileDraftRequestSchema rejects short natural language input', () => {
  const { error } = profileDraftRequestSchema.validate({
    input: 'Too short',
  });

  assert.ok(error);
  assert.match(
    error.message,
    /Profile draft input must be between 40 and 4000 characters/,
  );
});
