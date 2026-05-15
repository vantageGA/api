import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkoutSessionSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/userValidator.js';

const hyphenPassword = 'Valid-Password1';

test('registerSchema accepts a hyphen as the required password special character', () => {
  const { error } = registerSchema.validate({
    name: 'Valid User',
    email: 'valid@example.com',
    password: hyphenPassword,
  });

  assert.equal(error, undefined);
});

test('resetPasswordSchema accepts a hyphen as the required password special character', () => {
  const { error } = resetPasswordSchema.validate({
    resetPasswordToken: 'reset-token',
    password: hyphenPassword,
  });

  assert.equal(error, undefined);
});

test('registerSchema rejects passwords over 128 characters', () => {
  const { error } = registerSchema.validate({
    name: 'Valid User',
    email: 'valid@example.com',
    password: `Aa1-${'a'.repeat(125)}`,
  });

  assert.ok(error);
  assert.match(error.message, /Password cannot exceed 128 characters/);
});

test('checkoutSessionSchema validates only checkout lookup fields', () => {
  const { error, value } = checkoutSessionSchema.validate(
    {
      plan: 'monthly',
      name: 'Valid User',
      email: 'VALID@EXAMPLE.COM ',
      password: 'not-validated-for-existing-users',
      ignored: true,
    },
    { stripUnknown: true },
  );

  assert.equal(error, undefined);
  assert.equal(value.email, 'valid@example.com');
  assert.equal(value.name, undefined);
  assert.equal(value.password, undefined);
  assert.equal(value.ignored, undefined);
});
