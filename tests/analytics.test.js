import test from 'node:test';
import assert from 'node:assert/strict';
import { getCalendarBoundaries } from '../utils/timezone.js';
import {
  getMembershipAnalytics,
  getOnboardingAnalytics,
  getSearchAnalytics,
  recordSearchEvent,
} from '../services/analyticsService.js';
import { clearStripeAnalyticsCache, getStripeAnalytics } from '../services/stripeAnalyticsService.js';
import {
  getMemberLoginAnalytics,
  LOGIN_EVENT_RETENTION_DAYS,
  MEMBER_HEALTH_THRESHOLDS_DAYS,
  recordMemberLogin,
} from '../services/loginAnalyticsService.js';
import { analyticsOverviewQuerySchema, searchEventSchema } from '../validators/analyticsValidator.js';
import { adminUserListQuerySchema } from '../validators/userValidator.js';
import {
  captureMemberLoginAnalytics,
  deleteMemberLoginAnalytics,
  serializeAdminUser,
} from '../controllers/userController.js';
import { buildAnalyticsDataQualityWarnings } from '../controllers/analyticsController.js';
import {
  createSearchAnalyticsReceipt,
  verifySearchAnalyticsReceipt,
} from '../utils/searchAnalyticsReceipt.js';
import { getStripeConfigurationWarnings } from '../config/validateEnv.js';
import LoginEvent from '../models/loginEventModel.js';
import SearchEvent from '../models/searchEventModel.js';
import analyticsRoutes from '../routes/analyticsRoutes.js';

test('Europe/London calendar boundaries account for summer and winter offsets', () => {
  const summer = getCalendarBoundaries(new Date('2026-07-29T12:00:00.000Z'));
  const winter = getCalendarBoundaries(new Date('2026-01-29T12:00:00.000Z'));
  assert.equal(summer.day.toISOString(), '2026-07-28T23:00:00.000Z');
  assert.equal(winter.day.toISOString(), '2026-01-29T00:00:00.000Z');
  assert.equal(summer.week.toISOString(), '2026-07-26T23:00:00.000Z');
});

test('analytics models declare working TTL and deduplication indexes', () => {
  const loginIndexes = LoginEvent.schema.indexes();
  const searchIndexes = SearchEvent.schema.indexes();
  const indexFor = (indexes, key) => indexes.find(
    ([candidate]) => JSON.stringify(candidate) === JSON.stringify(key),
  );

  assert.equal(indexFor(loginIndexes, { expiresAt: 1 })[1].expireAfterSeconds, 0);
  assert.equal(indexFor(searchIndexes, { expiresAt: 1 })[1].expireAfterSeconds, 0);
  assert.equal(indexFor(searchIndexes, { eventId: 1 })[1].unique, true);
  assert.equal(indexFor(searchIndexes, { receiptNonce: 1 })[1].unique, true);
});

test('analytics router protects the overview and validates both route boundaries', () => {
  const overview = analyticsRoutes.stack.find(
    (layer) => layer.route?.path === '/admin/analytics/overview',
  );
  const capture = analyticsRoutes.stack.find(
    (layer) => layer.route?.path === '/analytics/search-events',
  );

  assert.equal(overview.route.methods.get, true);
  assert.deepEqual(
    overview.route.stack.slice(0, 2).map((layer) => layer.name),
    ['asyncUtilWrap', 'admin'],
  );
  assert.equal(overview.route.stack.length, 4);
  assert.equal(capture.route.methods.post, true);
  assert.equal(capture.route.stack.length, 3);
});

test('analytics schemas apply bounded defaults and reject excessive payloads', () => {
  assert.deepEqual(analyticsOverviewQuerySchema.validate({}).value, {
    timezone: 'Europe/London',
    searchDays: 30,
    months: 12,
  });
  assert.equal(adminUserListQuerySchema.validate({ limit: 101 }).error !== undefined, true);
  assert.equal(searchEventSchema.validate({
    eventId: 'event-1',
    sessionId: 'session-1',
    source: 'homepage',
    receipt: 'x'.repeat(2001),
  }).error !== undefined, true);
});

test('signed search receipts bind server results and persist no raw query', async () => {
  const secret = 'receipt-test-secret';
  const now = new Date('2026-07-29T12:00:00.000Z');
  const receipt = createSearchAnalyticsReceipt({
    query: 'Trainer person@example.test 07123 456789',
    profession: 'Personal Trainer',
    location: 'Manchester',
    resultsCount: 7,
    page: 1,
    source: 'homepage',
    now,
    secret,
    nonce: 'receipt-nonce-1',
  });
  const verified = verifySearchAnalyticsReceipt(receipt, { now, secret });
  assert.equal(verified.resultsCount, 7);
  assert.equal(verified.page, 1);
  assert.equal(verified.profession, 'personal trainer');

  let captured;
  const SearchEventModel = {
    create: async (event) => {
      captured = event;
      return event;
    },
  };
  await recordSearchEvent({
    eventId: 'event-1',
    sessionId: 'session-1',
    source: 'homepage',
    receipt,
  }, {
    SearchEventModel,
    now,
    receiptSecret: secret,
  });

  assert.equal(captured.resultsCount, 7);
  assert.equal(captured.criteriaCount, 3);
  assert.equal(captured.receiptNonce, 'receipt-nonce-1');
  assert.equal(captured.professionKey, 'personal trainer');
  assert.equal(captured.locationKey, 'manchester');
  assert.equal('normalizedQuery' in captured, false);
  assert.deepEqual(captured.keywordTokens, ['trainer']);
});

test('search receipts reject tampering, expiry, empty criteria, and source changes', async () => {
  const secret = 'receipt-test-secret';
  const now = new Date('2026-07-29T12:00:00.000Z');
  assert.equal(createSearchAnalyticsReceipt({
    resultsCount: 0,
    now,
    secret,
  }), null);

  const receipt = createSearchAnalyticsReceipt({
    query: 'strength',
    resultsCount: 2,
    source: 'homepage',
    now,
    ttlMs: 1000,
    secret,
    nonce: 'receipt-nonce-2',
  });
  assert.throws(
    () => verifySearchAnalyticsReceipt(`${receipt}tampered`, { now, secret }),
    /invalid search analytics receipt/i,
  );
  assert.throws(
    () => verifySearchAnalyticsReceipt(receipt, {
      now: new Date(now.getTime() + 1001),
      secret,
    }),
    /invalid search analytics receipt/i,
  );
  const laterPageReceipt = createSearchAnalyticsReceipt({
    query: 'strength',
    resultsCount: 2,
    page: 2,
    source: 'homepage',
    now,
    secret,
    nonce: 'receipt-nonce-page-2',
  });
  assert.throws(
    () => verifySearchAnalyticsReceipt(laterPageReceipt, { now, secret }),
    /invalid search analytics receipt/i,
  );
  await assert.rejects(
    recordSearchEvent({
      eventId: 'event-2',
      sessionId: 'session-2',
      source: 'directory',
      receipt,
    }, {
      SearchEventModel: { create: async () => ({}) },
      now,
      receiptSecret: secret,
    }),
    /invalid search analytics receipt/i,
  );
});

test('admin user serialization strips authentication and Stripe identifiers', () => {
  const result = serializeAdminUser({
    _id: 'user-1',
    name: 'Admin-visible member',
    email: 'member@example.test',
    password: 'password-hash',
    resetPasswordToken: 'reset-token',
    emailChangeToken: 'email-change-token',
    stripeCustomerId: 'stripe-customer',
    isConfirmed: true,
  });

  assert.deepEqual(result, {
    _id: 'user-1',
    name: 'Admin-visible member',
    email: 'member@example.test',
    isConfirmed: true,
  });
});

test('member login capture stores only the analytics identity and retention timestamps', async () => {
  let captured;
  const now = new Date('2026-07-29T12:00:00.000Z');
  const LoginEventModel = {
    create: async (event) => {
      captured = event;
      return event;
    },
  };
  let userUpdate;
  const UserModel = {
    updateOne: async (...args) => {
      userUpdate = args;
    },
  };

  await recordMemberLogin('member-1', { LoginEventModel, UserModel, now });

  assert.deepEqual(captured, {
    userId: 'member-1',
    accountType: 'member',
    occurredAt: now,
    expiresAt: new Date(
      now.getTime() + LOGIN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ),
  });
  assert.equal('email' in captured, false);
  assert.equal('ip' in captured, false);
  assert.equal('userAgent' in captured, false);
  assert.deepEqual(userUpdate, [
    { _id: 'member-1', isAdmin: { $ne: true } },
    { $max: { lastSuccessfulLoginAt: now } },
  ]);
});

test('successful login analytics excludes admins and never propagates capture failure', async () => {
  const recorded = [];
  const errors = [];
  const recordLogin = async (userId) => {
    recorded.push(userId);
    if (userId === 'member-fails') throw new Error('analytics unavailable');
  };
  const onError = (...args) => errors.push(args);

  assert.equal(captureMemberLoginAnalytics(
    { _id: 'admin-1', isAdmin: true },
    { recordLogin, onError },
  ), false);
  assert.equal(captureMemberLoginAnalytics(
    { _id: 'member-1', isAdmin: false },
    { recordLogin, onError },
  ), true);
  assert.equal(captureMemberLoginAnalytics(
    { _id: 'member-fails', isAdmin: false },
    { recordLogin, onError },
  ), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(recorded, ['member-1', 'member-fails']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], 'Failed to record member login analytics');
  assert.deepEqual(errors[0][2], { userId: 'member-fails' });
});

test('member deletion removes personally linked login analytics in the same session', async () => {
  const session = { id: 'transaction-session' };
  let call;
  const deleted = await deleteMemberLoginAnalytics('member-1', {
    LoginEventModel: {
      deleteMany: async (...args) => {
        call = args;
        return { deletedCount: 3 };
      },
    },
    session,
  });

  assert.equal(deleted, 3);
  assert.deepEqual(call, [{ userId: 'member-1' }, { session }]);
});

test('member login analytics separates sessions, unique members, and paid inactivity', async () => {
  const asOf = new Date('2026-07-29T12:00:00.000Z');
  const UserModel = {
    find: (query) => {
      assert.equal(query.isAdmin.$ne, true);
      return {
        select: () => ({
          lean: async () => [
            {
              _id: 'member-1',
              name: 'Avery Stone',
              email: 'avery@example.test',
              lastSuccessfulLoginAt: new Date('2026-07-29T10:00:00.000Z'),
            },
            {
              _id: 'member-2',
              name: 'Morgan Rivers',
              email: 'morgan@example.test',
              lastSuccessfulLoginAt: new Date('2026-07-28T08:00:00.000Z'),
            },
            {
              _id: 'member-3',
              name: 'Kit Mercer',
              email: 'kit@example.test',
              lastSuccessfulLoginAt: new Date('2026-06-15T08:00:00.000Z'),
            },
            { _id: 'member-4', name: 'Rowan Vale', email: 'rowan@example.test' },
          ],
        }),
      };
    },
  };
  const uniqueCounts = new Map([
    ['2026-07-28T23:00:00.000Z', ['member-1', 'member-2']],
    ['2026-07-26T23:00:00.000Z', ['member-1', 'member-2', 'member-3']],
    ['2026-06-30T23:00:00.000Z', ['member-1', 'member-2', 'member-3']],
  ]);
  const sessionCounts = new Map([
    ['2026-07-28T23:00:00.000Z', 3],
    ['2026-07-26T23:00:00.000Z', 7],
    ['2026-06-30T23:00:00.000Z', 11],
  ]);
  const LoginEventModel = {
    distinct: async (field, query) => {
      assert.equal(field, 'userId');
      if (query.userId) return ['member-1', 'member-2'];
      return uniqueCounts.get(query.occurredAt.$gte.toISOString()) || [];
    },
    countDocuments: async (query) => (
      sessionCounts.get(query.occurredAt.$gte.toISOString()) || 0
    ),
    aggregate: async (pipeline) => {
      const groupId = pipeline.find((stage) => stage.$group)?.$group?._id;
      if (typeof groupId === 'object') {
        return [
          { _id: '2026-06', sessions: 4, uniqueMembers: 2 },
          { _id: '2026-07', sessions: 11, uniqueMembers: 3 },
        ];
      }
      if (pipeline[0].$match.occurredAt) {
        return [
          {
            _id: 'member-1',
            sessions30Days: 9,
            lastLoginAt: new Date('2026-07-29T10:00:00.000Z'),
          },
          {
            _id: 'member-2',
            sessions30Days: 4,
            lastLoginAt: new Date('2026-07-28T08:00:00.000Z'),
          },
        ];
      }
      return [
        {
          _id: 'member-1',
          lastLoginAt: new Date('2026-07-29T10:00:00.000Z'),
        },
        {
          _id: 'member-2',
          lastLoginAt: new Date('2026-07-28T08:00:00.000Z'),
        },
        {
          _id: 'member-3',
          lastLoginAt: new Date('2026-06-15T08:00:00.000Z'),
        },
      ];
    },
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => ({ occurredAt: new Date('2026-06-14T09:00:00.000Z') }),
        }),
      }),
    }),
  };

  const result = await getMemberLoginAnalytics({
    asOf,
    months: 2,
    UserModel,
    LoginEventModel,
  });

  assert.deepEqual(result.uniqueMembers, { today: 2, week: 3, month: 3 });
  assert.deepEqual(result.sessions, { today: 3, week: 7, month: 11 });
  assert.equal(result.activePaidSeen30Days, 2);
  assert.equal(result.activePaidInactive30Days, 2);
  assert.deepEqual(result.health, {
    cohort: 'active_paid_members',
    cohortSize: 4,
    measuredMembers: 3,
    coveragePercent: 75,
    thresholdsDays: MEMBER_HEALTH_THRESHOLDS_DAYS,
    segments: [
      {
        key: 'healthy',
        label: 'Healthy',
        count: 2,
        definition: 'Last sign-in within 7 days',
      },
      {
        key: 'occasional',
        label: 'Occasional',
        count: 0,
        definition: 'Last sign-in 8–30 days ago',
      },
      {
        key: 'slipping',
        label: 'Slipping',
        count: 1,
        definition: 'Last sign-in 31–60 days ago',
      },
      {
        key: 'atRisk',
        label: 'At risk',
        count: 0,
        definition: 'Last captured sign-in more than 60 days ago',
      },
      {
        key: 'unmeasured',
        label: 'Not yet measured',
        count: 1,
        definition: 'No login captured since measurement began',
      },
    ],
  });
  assert.deepEqual(result.mostActiveMembers, [
    {
      memberId: 'member-1',
      name: 'Avery Stone',
      email: 'avery@example.test',
      sessions30Days: 9,
      lastLoginAt: new Date('2026-07-29T10:00:00.000Z'),
    },
    {
      memberId: 'member-2',
      name: 'Morgan Rivers',
      email: 'morgan@example.test',
      sessions30Days: 4,
      lastLoginAt: new Date('2026-07-28T08:00:00.000Z'),
    },
  ]);
  assert.deepEqual(result.inactivePaidMembers, [
    {
      memberId: 'member-4',
      name: 'Rowan Vale',
      email: 'rowan@example.test',
      lastLoginAt: null,
    },
    {
      memberId: 'member-3',
      name: 'Kit Mercer',
      email: 'kit@example.test',
      lastLoginAt: new Date('2026-06-15T08:00:00.000Z'),
    },
  ]);
  assert.deepEqual(result.trend, [
    { month: '2026-06', sessions: 4, uniqueMembers: 2 },
    { month: '2026-07', sessions: 11, uniqueMembers: 3 },
  ]);
  assert.equal(result.completeFrom, null);
  assert.equal(
    result.firstRetainedEventAt.toISOString(),
    '2026-06-14T09:00:00.000Z',
  );
  assert.match(result.limitations[0], /no authoritative completeness start/i);

  const invalidStartResult = await getMemberLoginAnalytics({
    asOf,
    months: 2,
    UserModel,
    LoginEventModel,
    captureStartedAt: new Date('not-a-date'),
  });
  assert.equal(invalidStartResult.completeFrom, null);
  assert.match(
    invalidStartResult.limitations[0],
    /no authoritative completeness start/i,
  );
});

test('onboarding analytics returns a cumulative current-state funnel', async () => {
  let capturedPipeline;
  const UserModel = {
    aggregate: async (pipeline) => {
      capturedPipeline = pipeline;
      return [{
        registered: [{ count: 17 }],
        emailVerified: [{ count: 13 }],
        activePaid: [{ count: 9 }],
        profileCreated: [{ count: 8 }],
        tutorialCompleted: [{ count: 6 }],
        coreDetailsAdded: [{ count: 5 }],
        qualificationApproved: [{ count: 3 }],
      }];
    },
  };
  const ProfileModel = { collection: { name: 'profiles' } };

  const result = await getOnboardingAnalytics({
    asOf: new Date('2026-07-29T12:00:00.000Z'),
    UserModel,
    ProfileModel,
  });

  assert.equal(capturedPipeline[1].$lookup.from, 'profiles');
  assert.deepEqual(
    result.stages.map(({ key, count, dropOffFromPrevious }) => ({
      key,
      count,
      dropOffFromPrevious,
    })),
    [
      { key: 'registered', count: 17, dropOffFromPrevious: 0 },
      { key: 'emailVerified', count: 13, dropOffFromPrevious: 4 },
      { key: 'activePaid', count: 9, dropOffFromPrevious: 4 },
      { key: 'profileCreated', count: 8, dropOffFromPrevious: 1 },
      { key: 'tutorialCompleted', count: 6, dropOffFromPrevious: 2 },
      { key: 'coreDetailsAdded', count: 5, dropOffFromPrevious: 1 },
      { key: 'qualificationApproved', count: 3, dropOffFromPrevious: 2 },
    ],
  );
  assert.equal(result.stages.at(-1).percentOfRegistered, 18);
  assert.equal(result.cohort, 'current_non_admin_members');
});

test('search analytics ranks profession and location demand against public supply', async () => {
  const UserModel = {
    distinct: async () => ['member-1', 'member-2', 'member-3'],
  };
  const ProfileModel = {
    aggregate: async (pipeline) => {
      assert.equal(pipeline[0].$lookup.from, 'users');
      const projectStage = pipeline.find((stage) => stage.$project);
      const dimensionInput = projectStage.$project.dimension.$toLower.$trim.input.$ifNull[0];
      if (dimensionInput === '$specialisation') {
        return [
          { _id: 'personal trainer', supply: 2 },
          { _id: 'Personal  Trainer', supply: 1 },
          { _id: 'physiotherapist', supply: 1 },
        ];
      }
      return [{ _id: 'manchester', supply: 1 }];
    },
  };
  const SearchEventModel = {
    aggregate: async (pipeline) => {
      if (pipeline.some((stage) => stage.$unwind === '$keywordTokens')) {
        return [{ label: 'strength', count: 4 }];
      }
      const match = pipeline[0].$match;
      if (match.professionKey) {
        return [
          {
            _id: 'sports massage',
            searches: 7,
            noResultSearches: 5,
          },
          {
            _id: 'personal trainer',
            searches: 6,
            noResultSearches: 0,
          },
        ];
      }
      return [
        { _id: 'leeds', searches: 8, noResultSearches: 6 },
        { _id: 'manchester', searches: 5, noResultSearches: 1 },
      ];
    },
    countDocuments: async (query) => (query.resultsCount === 0 ? 6 : 13),
    findOne: () => ({
      sort: () => ({
        select: () => ({
          lean: async () => ({ occurredAt: new Date('2026-07-10T09:00:00.000Z') }),
        }),
      }),
    }),
  };

  const result = await getSearchAnalytics({
    asOf: new Date('2026-07-29T12:00:00.000Z'),
    days: 30,
    SearchEventModel,
    UserModel,
    ProfileModel,
  });

  assert.deepEqual(result.topProfessions, [
    { label: 'sports massage', count: 7 },
    { label: 'personal trainer', count: 6 },
  ]);
  assert.deepEqual(result.demandSupply.professions, [
    {
      label: 'sports massage',
      searches: 7,
      noResultSearches: 5,
      supply: 0,
      demandPerProfile: null,
      status: 'no_supply',
    },
    {
      label: 'personal trainer',
      searches: 6,
      noResultSearches: 0,
      supply: 3,
      demandPerProfile: 2,
      status: 'covered',
    },
  ]);
  assert.deepEqual(result.demandSupply.locations[0], {
    label: 'leeds',
    searches: 8,
    noResultSearches: 6,
    supply: 0,
    demandPerProfile: null,
    status: 'no_supply',
  });
});

test('membership analytics treats every canonical inactive Stripe status as expired', async () => {
  const capturedQueries = [];
  const UserModel = {
    countDocuments: async (query) => {
      capturedQueries.push(query);
      return 0;
    },
    aggregate: async () => [],
  };
  const ProfileModel = {
    aggregate: async (pipeline) => {
      const ownerMatch = pipeline.find((stage) => stage.$match?.['owner.isAdmin']);
      assert.deepEqual(ownerMatch, { $match: { 'owner.isAdmin': { $ne: true } } });
      return [];
    },
  };

  await getMembershipAnalytics({
    asOf: new Date('2026-07-29T12:00:00.000Z'),
    months: 1,
    UserModel,
    ProfileModel,
  });

  const expiredQuery = capturedQueries.find((query) => (
    query.$and?.some((condition) => (
      condition.$or?.some((entry) => entry.paymentStatus?.$in?.includes('paused'))
    ))
  ));
  const statuses = expiredQuery.$and
    .flatMap((condition) => condition.$or || [])
    .find((entry) => entry.paymentStatus?.$in)
    .paymentStatus.$in;
  assert.equal(statuses.includes('paused'), true);
  assert.equal(statuses.includes('incomplete'), true);
});

test('Stripe key validation reports mode mismatch without exposing key values', () => {
  const warnings = getStripeConfigurationWarnings({
    STRIPE_SECRET_KEY: 'sk_live_example',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
  });
  assert.deepEqual(warnings, [
    'Stripe secret and publishable keys use different test/live modes',
  ]);
});

test('Stripe analytics is unavailable when the configured client is disabled', async () => {
  clearStripeAnalyticsCache();
  const result = await getStripeAnalytics({
    stripeClient: {
      __isConfigured: false,
      invoices: { list: async () => ({ data: [], has_more: false }) },
      subscriptions: { list: async () => ({ data: [], has_more: false }) },
    },
    bypassCache: true,
  });
  assert.deepEqual(result, {
    available: false,
    reason: 'Stripe analytics is not configured.',
  });
});

test('data-quality warnings detect active-subscription mismatch, mixed currency, and stale data', () => {
  const warnings = buildAnalyticsDataQualityWarnings(
    { activePaidMembers: 4 },
    {
      available: true,
      stale: true,
      subscriptionCounts: { total: 9, activeOrTrialing: 1 },
      currencies: [{ currency: 'gbp' }, { currency: 'eur' }],
    },
  );
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /returned 1 active or trialing subscriptions/);
  assert.match(warnings[1], /2 currencies/);
  assert.match(warnings[2], /stale cached financial data/);
});

test('Stripe analytics paginates, groups minor units and counts upcoming renewals', async () => {
  clearStripeAnalyticsCache();
  const invoiceCalls = [];
  const stripeClient = {
    invoices: {
      list: async (params) => {
        invoiceCalls.push(params);
        if (params.status === 'open') {
          return {
            data: [
              {
                id: 'open-1',
                currency: 'gbp',
                amount_remaining: 2500,
                parent: {
                  type: 'subscription_details',
                  subscription_details: { subscription: 'sub-1' },
                },
              },
              {
                id: 'manual-open',
                currency: 'gbp',
                amount_remaining: 9999,
                parent: null,
              },
            ],
            has_more: false,
          };
        }
        if (!params.starting_after) {
          return {
            data: [
              {
                id: 'paid-1',
                currency: 'gbp',
                amount_paid: 1000,
                created: 1785312000,
                status_transitions: { paid_at: 1785312000 },
                parent: {
                  type: 'subscription_details',
                  subscription_details: { subscription: 'sub-1' },
                },
              },
              {
                id: 'manual-paid',
                currency: 'gbp',
                amount_paid: 9999,
                created: 1785312000,
                status_transitions: { paid_at: 1785312000 },
                parent: null,
              },
              {
                id: 'paid-without-payment-time',
                currency: 'gbp',
                amount_paid: 7500,
                created: 1785312000,
                status_transitions: { paid_at: null },
                parent: {
                  type: 'subscription_details',
                  subscription_details: { subscription: 'sub-1' },
                },
              },
            ],
            has_more: true,
          };
        }
        return {
          data: [{
            id: 'paid-2',
            currency: 'gbp',
            amount_paid: 500,
            created: 1767139200,
            status_transitions: { paid_at: 1769904000 },
            parent: {
              type: 'subscription_details',
              subscription_details: { subscription: 'sub-1' },
            },
          }],
          has_more: false,
        };
      },
    },
    subscriptions: {
      list: async () => ({
        data: [{
          id: 'sub-1',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [{ current_period_end: 1786618800 }],
          },
        }],
        has_more: false,
      }),
    },
  };
  const result = await getStripeAnalytics({
    asOf: new Date('2026-07-29T12:00:00.000Z'),
    stripeClient,
    bypassCache: true,
  });
  assert.equal(result.available, true);
  assert.equal(result.currencies[0].yearToDateMinor, 1500);
  assert.equal(result.currencies[0].monthToDateMinor, 1000);
  assert.equal(result.currencies[0].outstandingMinor, 2500);
  assert.equal(result.renewalsDue30Days, 1);
  assert.deepEqual(result.subscriptionCounts, { total: 1, activeOrTrialing: 1 });
  assert.equal(
    invoiceCalls.some(
      (call) => call.starting_after === 'paid-without-payment-time',
    ),
    true,
  );
  assert.equal(invoiceCalls.some((call) => call.created), false);
});

test('Stripe analytics times out safely and serves stale cached data', async () => {
  clearStripeAnalyticsCache();
  const successfulClient = {
    invoices: {
      list: async () => ({ data: [], has_more: false }),
    },
    subscriptions: {
      list: async () => ({ data: [], has_more: false }),
    },
  };
  const asOf = new Date('2026-07-29T12:00:00.000Z');
  await getStripeAnalytics({
    asOf,
    stripeClient: successfulClient,
    bypassCache: true,
  });

  const never = () => new Promise(() => {});
  const errors = [];
  const stale = await getStripeAnalytics({
    asOf,
    stripeClient: {
      invoices: { list: never },
      subscriptions: { list: never },
    },
    bypassCache: true,
    timeoutMs: 5,
    onError: (...args) => errors.push(args),
  });

  assert.equal(stale.available, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.cached, true);
  assert.equal(errors.length, 1);
});
