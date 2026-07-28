import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';

import {
  getReviewerVerificationRedirectUrl,
  updateConfirmReviewerEmail,
} from '../controllers/confirmEmailController.js';
import UserReviewer from '../models/userReviewerModel.js';

const originalFindById = UserReviewer.findById;
const originalEnv = {
  CONFIRM_REDIRECT_URL: process.env.CONFIRM_REDIRECT_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  RESET_PASSWORD_LOCAL_URL: process.env.RESET_PASSWORD_LOCAL_URL,
  RESET_PASSWORD_PRODUCTION_URL: process.env.RESET_PASSWORD_PRODUCTION_URL,
};

const createRequest = (token) => ({
  query: token ? { token } : {},
  params: {},
  ip: '127.0.0.1',
  get: () => 'node-test',
});

const createResponse = () => ({
  redirectStatus: null,
  redirectUrl: null,
  redirect(status, url) {
    this.redirectStatus = status;
    this.redirectUrl = url;
    return this;
  },
});

const runController = async (request, response) => {
  let nextError;
  await updateConfirmReviewerEmail(request, response, (error) => {
    nextError = error;
  });
  return nextError;
};

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough';
  process.env.FRONTEND_URL = 'https://bodyvantage.example';
  delete process.env.CONFIRM_REDIRECT_URL;
  delete process.env.RESET_PASSWORD_PRODUCTION_URL;
});

afterEach(() => {
  UserReviewer.findById = originalFindById;

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('builds a reviewer login redirect without including the token', () => {
  const redirectUrl = getReviewerVerificationRedirectUrl('verified');

  assert.equal(
    redirectUrl,
    'https://bodyvantage.example/reviewer-login?verification=verified',
  );
  assert.equal(redirectUrl.includes('token='), false);
});

test('verifies a reviewer and redirects to the frontend login page', async () => {
  let wasSaved = false;
  const reviewer = {
    _id: 'reviewer-1',
    isConfirmed: false,
    async save() {
      wasSaved = true;
    },
  };
  UserReviewer.findById = async () => reviewer;

  const token = jwt.sign(
    { id: reviewer._id, type: 'email_verification' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  const response = createResponse();

  const nextError = await runController(createRequest(token), response);

  assert.equal(nextError, undefined);
  assert.equal(wasSaved, true);
  assert.equal(reviewer.isConfirmed, true);
  assert.equal(response.redirectStatus, 303);
  assert.equal(
    response.redirectUrl,
    'https://bodyvantage.example/reviewer-login?verification=verified',
  );
});

test('rejects non-verification tokens and redirects without confirming', async () => {
  let findByIdCalled = false;
  UserReviewer.findById = async () => {
    findByIdCalled = true;
    return null;
  };

  const token = jwt.sign(
    { id: 'reviewer-1', type: 'auth' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  const response = createResponse();

  const nextError = await runController(createRequest(token), response);

  assert.equal(nextError, undefined);
  assert.equal(findByIdCalled, false);
  assert.equal(response.redirectStatus, 303);
  assert.equal(
    response.redirectUrl,
    'https://bodyvantage.example/reviewer-login?verification=invalid',
  );
});

test('redirects missing and malformed verification tokens as invalid', async () => {
  for (const token of [null, 'not-a-jwt']) {
    const response = createResponse();
    const nextError = await runController(createRequest(token), response);

    assert.equal(nextError, undefined);
    assert.equal(response.redirectStatus, 303);
    assert.equal(
      response.redirectUrl,
      'https://bodyvantage.example/reviewer-login?verification=invalid',
    );
  }
});

test('redirects expired verification tokens as invalid', async () => {
  const token = jwt.sign(
    { id: 'reviewer-1', type: 'email_verification' },
    process.env.JWT_SECRET,
    { expiresIn: -1 },
  );
  const response = createResponse();

  const nextError = await runController(createRequest(token), response);

  assert.equal(nextError, undefined);
  assert.equal(
    response.redirectUrl,
    'https://bodyvantage.example/reviewer-login?verification=invalid',
  );
});

test('redirects an unknown reviewer as invalid', async () => {
  UserReviewer.findById = async () => null;
  const token = jwt.sign(
    { id: 'missing-reviewer', type: 'email_verification' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  const response = createResponse();

  const nextError = await runController(createRequest(token), response);

  assert.equal(nextError, undefined);
  assert.equal(
    response.redirectUrl,
    'https://bodyvantage.example/reviewer-login?verification=invalid',
  );
});

test('redirects an already-confirmed reviewer without saving again', async () => {
  let wasSaved = false;
  UserReviewer.findById = async () => ({
    _id: 'reviewer-1',
    isConfirmed: true,
    async save() {
      wasSaved = true;
    },
  });
  const token = jwt.sign(
    { id: 'reviewer-1', type: 'email_verification' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  const response = createResponse();

  const nextError = await runController(createRequest(token), response);

  assert.equal(nextError, undefined);
  assert.equal(wasSaved, false);
  assert.equal(
    response.redirectUrl,
    'https://bodyvantage.example/reviewer-login?verification=already-verified',
  );
});

test('forwards reviewer save failures to operational error handling', async () => {
  UserReviewer.findById = async () => ({
    _id: 'reviewer-1',
    isConfirmed: false,
    async save() {
      throw new Error('database unavailable');
    },
  });
  const token = jwt.sign(
    { id: 'reviewer-1', type: 'email_verification' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  const response = createResponse();

  const nextError = await runController(createRequest(token), response);

  assert.equal(nextError?.message, 'database unavailable');
  assert.equal(response.redirectUrl, null);
});

test('forwards missing frontend configuration as an operational error', async () => {
  delete process.env.CONFIRM_REDIRECT_URL;
  delete process.env.FRONTEND_URL;
  delete process.env.RESET_PASSWORD_LOCAL_URL;
  delete process.env.RESET_PASSWORD_PRODUCTION_URL;
  const response = createResponse();

  const nextError = await runController(createRequest(null), response);

  assert.equal(nextError?.message, 'Frontend URL is not configured');
  assert.equal(response.redirectUrl, null);
});
