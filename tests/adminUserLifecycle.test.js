import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  deleteUser,
  updateIsAdmin,
} from '../controllers/userController.js';
import User from '../models/userModel.js';

const originalFindById = User.findById;

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});

const runController = async (controller, request, response) => {
  let nextError;
  await controller(request, response, (error) => {
    nextError = error;
  });
  return nextError;
};

const adminId = '507f1f77bcf86cd799439011';
const memberId = '507f1f77bcf86cd799439012';

const buildUser = (overrides = {}) => {
  const user = {
    _id: memberId,
    name: 'Member Person',
    email: 'member@example.test',
    isAdmin: false,
    isConfirmed: true,
    password: 'password-hash',
    stripeCustomerId: 'cus_private',
    async save() {
      return this;
    },
    ...overrides,
  };
  user.toObject = () => ({ ...user });
  return user;
};

afterEach(() => {
  User.findById = originalFindById;
});

test('admin role updates return the safe admin user allowlist', async () => {
  const user = buildUser();
  User.findById = async () => user;
  const response = createResponse();

  const nextError = await runController(
    updateIsAdmin,
    {
      params: { id: memberId },
      body: { val: true },
      user: { _id: adminId },
      ip: '127.0.0.1',
      get: () => 'node-test',
    },
    response,
  );

  assert.equal(nextError, undefined);
  assert.equal(response.body.isAdmin, true);
  assert.equal(response.body.email, user.email);
  assert.equal('password' in response.body, false);
  assert.equal('stripeCustomerId' in response.body, false);
});

test('unconfirmed members cannot be granted admin access', async () => {
  User.findById = async () => buildUser({ isConfirmed: false });
  const response = createResponse();

  const nextError = await runController(
    updateIsAdmin,
    {
      params: { id: memberId },
      body: { val: true },
      user: { _id: adminId },
      ip: '127.0.0.1',
      get: () => 'node-test',
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(nextError.message, /confirmed users/i);
});

test('an administrator cannot remove their own admin access', async () => {
  User.findById = async () =>
    buildUser({ _id: adminId, isAdmin: true });
  const response = createResponse();

  const nextError = await runController(
    updateIsAdmin,
    {
      params: { id: adminId },
      body: { val: false },
      user: { _id: adminId },
      ip: '127.0.0.1',
      get: () => 'node-test',
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(nextError.message, /own admin access/i);
});

test('admin accounts must be demoted before account deletion', async () => {
  User.findById = async () => buildUser({ isAdmin: true });
  const response = createResponse();

  const nextError = await runController(
    deleteUser,
    {
      params: { id: memberId },
      user: { _id: adminId },
      ip: '127.0.0.1',
      get: () => 'node-test',
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(nextError.message, /demoted before deletion/i);
});
