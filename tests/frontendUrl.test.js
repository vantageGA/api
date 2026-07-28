import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  buildFrontendUrl,
  getFrontendBaseUrl,
} from '../utils/frontendUrl.js';

const envKeys = [
  'CONFIRM_REDIRECT_URL',
  'FRONTEND_URL',
  'NODE_ENV',
  'RESET_PASSWORD_LOCAL_URL',
  'RESET_PASSWORD_PRODUCTION_URL',
];
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);

const clearFrontendEnv = () => {
  for (const key of envKeys) {
    delete process.env[key];
  }
};

afterEach(() => {
  clearFrontendEnv();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
});

test('development prefers the local frontend fallback', () => {
  clearFrontendEnv();
  process.env.NODE_ENV = 'development';
  process.env.RESET_PASSWORD_LOCAL_URL = 'http://localhost:5173';
  process.env.RESET_PASSWORD_PRODUCTION_URL = 'https://bodyvantage.example';

  assert.equal(getFrontendBaseUrl(), 'http://localhost:5173');
});

test('production prefers the production frontend fallback', () => {
  clearFrontendEnv();
  process.env.NODE_ENV = 'production';
  process.env.RESET_PASSWORD_LOCAL_URL = 'http://localhost:5173';
  process.env.RESET_PASSWORD_PRODUCTION_URL = 'https://bodyvantage.example';

  assert.equal(getFrontendBaseUrl(), 'https://bodyvantage.example');
});

test('a canonical redirect origin overrides environment fallbacks', () => {
  clearFrontendEnv();
  process.env.NODE_ENV = 'development';
  process.env.CONFIRM_REDIRECT_URL = 'https://canonical.example/base-path';
  process.env.FRONTEND_URL = 'https://frontend.example';
  process.env.RESET_PASSWORD_LOCAL_URL = 'http://localhost:5173';

  assert.equal(
    buildFrontendUrl('/reviewer-login', { verification: 'verified' }),
    'https://canonical.example/reviewer-login?verification=verified',
  );
});

test('rejects frontend URLs that do not use HTTP or HTTPS', () => {
  clearFrontendEnv();
  process.env.FRONTEND_URL = 'file:///tmp/bodyvantage';

  assert.throws(
    () => getFrontendBaseUrl(),
    /must use HTTP or HTTPS/,
  );
});

test('rejects missing frontend URL configuration', () => {
  clearFrontendEnv();

  assert.throws(
    () => getFrontendBaseUrl(),
    /Frontend URL is not configured/,
  );
});
