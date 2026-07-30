import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import mongoose from 'mongoose';

import {
  deleteReviewer,
  getAllUsersReviews,
  getAllUsersReviewers,
} from '../controllers/userReviewsController.js';
import Profile from '../models/profileModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import userReviewRoutes from '../routes/userReviewRoutes.js';
import {
  serializeReviewer,
  serializeReviewers,
} from '../utils/userReviewerSerializer.js';
import {
  adminReviewerListQuerySchema,
  reviewerIdSchema,
} from '../validators/userReviewerValidator.js';

const originalFind = UserReviewer.find;
const originalFindById = UserReviewer.findById;
const originalFindOneAndUpdate = UserReviewer.findOneAndUpdate;
const originalDeleteOne = UserReviewer.deleteOne;
const originalUpdateOne = UserReviewer.updateOne;
const originalExists = UserReviewer.exists;
const originalCountDocuments = UserReviewer.countDocuments;
const originalProfileUpdateMany = Profile.updateMany;
const originalStartSession = mongoose.startSession;

const sensitiveReviewer = {
  _id: 'reviewer-1',
  name: 'Reviewer',
  email: 'reviewer@example.test',
  isConfirmed: true,
  hasSubmittedReview: false,
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-07-02T10:00:00.000Z'),
  password: 'password-hash',
  resetPasswordToken: 'reset-token-hash',
  resetPasswordTokenExpiry: new Date('2026-07-02T11:00:00.000Z'),
  resetPasswordAttempts: 3,
};

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

afterEach(() => {
  UserReviewer.find = originalFind;
  UserReviewer.findById = originalFindById;
  UserReviewer.findOneAndUpdate = originalFindOneAndUpdate;
  UserReviewer.deleteOne = originalDeleteOne;
  UserReviewer.updateOne = originalUpdateOne;
  UserReviewer.exists = originalExists;
  UserReviewer.countDocuments = originalCountDocuments;
  Profile.updateMany = originalProfileUpdateMany;
  mongoose.startSession = originalStartSession;
});

test('reviewer serializer exposes only the explicit account allowlist', () => {
  const safeReviewer = serializeReviewer(sensitiveReviewer);

  assert.deepEqual(Object.keys(safeReviewer).sort(), [
    '_id',
    'createdAt',
    'email',
    'hasSubmittedReview',
    'isConfirmed',
    'name',
    'updatedAt',
  ]);
  assert.equal('password' in safeReviewer, false);
  assert.equal('resetPasswordToken' in safeReviewer, false);
  assert.equal(serializeReviewers([sensitiveReviewer]).length, 1);
});

test('reviewer model excludes password and reset metadata by default', () => {
  for (const path of [
    'password',
    'resetPasswordToken',
    'resetPasswordTokenExpiry',
    'resetPasswordAttempts',
    'resetPasswordLastAttempt',
    'deletionPending',
  ]) {
    assert.equal(UserReviewer.schema.path(path).options.select, false);
  }
});

test('reviewer list validation is bounded and reviewer ids are validated', () => {
  assert.deepEqual(adminReviewerListQuerySchema.validate({}).value, {
    page: 1,
    limit: 25,
    search: '',
  });
  assert.equal(
    adminReviewerListQuerySchema.validate({ limit: 101 }).error !== undefined,
    true,
  );
  assert.equal(
    adminReviewerListQuerySchema.validate({ search: 'x'.repeat(201) }).error !==
      undefined,
    true,
  );
  assert.equal(
    reviewerIdSchema.validate({ id: 'not-an-object-id' }).error !== undefined,
    true,
  );
});

test('reviewer routes protect self details and validate admin list/delete boundaries', () => {
  const routeFor = (path) =>
    userReviewRoutes.stack.find((layer) => layer.route?.path === path)?.route;
  const adminList = routeFor('/reviewers/admin');
  const selfDetails = routeFor('/reviewers/me');
  const adminDelete = routeFor('/reviewer/admin/:id');

  assert.deepEqual(
    adminList.stack.slice(0, 3).map((layer) => layer.name),
    ['asyncUtilWrap', 'admin', '<anonymous>'],
  );
  assert.equal(selfDetails.stack[0].name, 'asyncUtilWrap');
  assert.equal(adminDelete.stack.length, 4);
  assert.equal(routeFor('/reviewer/public/:id'), undefined);
});

test('authenticated reviewer details use the safe response', async () => {
  const response = createResponse();
  const nextError = await runController(
    getAllUsersReviewers,
    { reviewer: sensitiveReviewer },
    response,
  );

  assert.equal(nextError, undefined);
  assert.equal(response.body.email, sensitiveReviewer.email);
  assert.equal('password' in response.body, false);
});

test('admin reviewer list is paginated and serialized', async () => {
  const query = {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    async lean() {
      return [sensitiveReviewer];
    },
  };
  UserReviewer.find = () => query;
  UserReviewer.countDocuments = async () => 26;
  const response = createResponse();

  const nextError = await runController(
    getAllUsersReviews,
    {
      query: {
        page: 2,
        limit: 25,
        search: '',
      },
    },
    response,
  );

  assert.equal(nextError, undefined);
  assert.equal(response.body.page, 2);
  assert.equal(response.body.pages, 2);
  assert.equal(response.body.total, 26);
  assert.equal(response.body.reviewers.length, 1);
  assert.equal('password' in response.body.reviewers[0], false);
});

test('deleting a reviewer anonymizes linked reviews before removing the account', async () => {
  let anonymizeUpdate;
  let deleted = false;
  const reviewer = { ...sensitiveReviewer };
  UserReviewer.findOneAndUpdate = () => ({
    async select() {
      return reviewer;
    },
  });
  UserReviewer.deleteOne = async () => {
    deleted = true;
  };
  Profile.updateMany = async (...args) => {
    anonymizeUpdate = args;
    return { matchedCount: 2, modifiedCount: 2 };
  };
  mongoose.startSession = async () => ({
    async withTransaction(callback) {
      await callback();
    },
    async endSession() {},
  });
  const response = createResponse();

  const nextError = await runController(
    deleteReviewer,
    {
      params: { id: reviewer._id },
      user: { _id: 'admin-1' },
      ip: '127.0.0.1',
      get: () => 'node-test',
    },
    response,
  );

  assert.equal(nextError, undefined);
  assert.equal(deleted, true);
  assert.equal(anonymizeUpdate[0]['reviews.user'], reviewer._id);
  assert.equal(
    anonymizeUpdate[1].$set['reviews.$[review].name'],
    'Deleted reviewer',
  );
  assert.ok(anonymizeUpdate[2].session);
  assert.equal(response.body.anonymisedProfiles, 2);
});
