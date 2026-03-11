import test from 'node:test';
import assert from 'node:assert/strict';
import { updateProfileSchema } from '../validators/profileValidator.js';

test('updateProfileSchema accepts Quill HTML when visible specialisation text is within the limit', () => {
  const specialisation = `<p>${'<strong>fit</strong>'.repeat(100)}</p>`;
  const { error } = updateProfileSchema.validate({ specialisation });

  assert.equal(error, undefined);
});

test('updateProfileSchema rejects specialisation when visible text exceeds the limit', () => {
  const specialisation = `<p>${'a'.repeat(401)}</p>`;
  const { error } = updateProfileSchema.validate({ specialisation });

  assert.ok(error);
  assert.match(error.message, /Specialisation must not exceed 400 characters/);
});
