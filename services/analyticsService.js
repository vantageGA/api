import crypto from 'crypto';
import User from '../models/userModel.js';
import Profile from '../models/profileModel.js';
import SearchEvent from '../models/searchEventModel.js';
import { buildActivePaidMemberQuery } from '../utils/analyticsQueries.js';
import { getCalendarBoundaries, getMonthWindow } from '../utils/timezone.js';
import {
  normalizeSearchDimension,
  privacySafeQueryTokens,
  verifySearchAnalyticsReceipt,
} from '../utils/searchAnalyticsReceipt.js';
import { INACTIVE_STRIPE_STATUSES } from '../utils/subscriptionStatus.js';

const INACTIVE_STATUSES = [...INACTIVE_STRIPE_STATUSES, 'cancelled'];

export const recordSearchEvent = async (payload, {
  SearchEventModel = SearchEvent,
  retentionDays = 180,
  now = new Date(),
  receiptSecret = process.env.JWT_SECRET,
} = {}) => {
  const receipt = verifySearchAnalyticsReceipt(payload.receipt, {
    now,
    secret: receiptSecret,
  });
  if (payload.source !== receipt.source) {
    const error = new Error('Expired or invalid search analytics receipt.');
    error.code = 'INVALID_SEARCH_ANALYTICS_RECEIPT';
    throw error;
  }
  const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  const criteriaCount = [
    receipt.query,
    receipt.profession,
    receipt.location,
  ].filter(Boolean).length;
  try {
    await SearchEventModel.create({
      eventId: payload.eventId,
      keywordTokens: privacySafeQueryTokens(receipt.query),
      professionKey: normalizeSearchDimension(receipt.profession),
      locationKey: normalizeSearchDimension(receipt.location),
      resultsCount: receipt.resultsCount,
      criteriaCount,
      receiptNonce: receipt.nonce,
      sessionHash: crypto.createHash('sha256').update(payload.sessionId).digest('hex'),
      source: receipt.source,
      expiresAt,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
};

const demandDimension = (field, since, SearchEventModel) => SearchEventModel.aggregate([
  {
    $match: {
      occurredAt: { $gte: since },
      [field]: { $ne: '' },
    },
  },
  {
    $group: {
      _id: `$${field}`,
      searches: { $sum: 1 },
      noResultSearches: {
        $sum: {
          $cond: [
            {
              $and: [
                { $eq: ['$resultsCount', 0] },
                { $eq: ['$criteriaCount', 1] },
              ],
            },
            1,
            0,
          ],
        },
      },
    },
  },
  { $sort: { searches: -1, noResultSearches: -1, _id: 1 } },
  { $limit: 20 },
]);

const supplyDimension = async (field, ProfileModel, UserModel) => {
  const rows = await ProfileModel.aggregate([
    {
      $lookup: {
        from: UserModel.collection?.name || 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'owner',
      },
    },
    { $unwind: '$owner' },
    {
      $match: {
        'owner.publicProfileStatus': { $in: ['active', null] },
      },
    },
    {
      $project: {
        dimension: {
          $toLower: {
            $trim: { input: { $ifNull: [`$${field}`, ''] } },
          },
        },
      },
    },
    { $match: { dimension: { $ne: '' } } },
    { $group: { _id: '$dimension', supply: { $sum: 1 } } },
  ]);
  const normalized = new Map();
  rows.forEach((row) => {
    const key = normalizeSearchDimension(row._id);
    if (key) normalized.set(key, (normalized.get(key) || 0) + row.supply);
  });
  return [...normalized].map(([_id, supply]) => ({ _id, supply }));
};

const buildDemandSupplyRows = (demandRows, supplyRows) => {
  const supplyByDimension = new Map(
    supplyRows.map((row) => [row._id, row.supply]),
  );
  const statusPriority = { no_supply: 0, undersupplied: 1, covered: 2 };
  return demandRows
    .map((row) => {
      const supply = supplyByDimension.get(row._id) || 0;
      const demandPerProfile = supply
        ? Number((row.searches / supply).toFixed(1))
        : null;
      const status = supply === 0
        ? 'no_supply'
        : row.noResultSearches > 0 || demandPerProfile >= 3
          ? 'undersupplied'
          : 'covered';
      return {
        label: row._id,
        searches: row.searches,
        noResultSearches: row.noResultSearches,
        supply,
        demandPerProfile,
        status,
      };
    })
    .sort((left, right) => (
      statusPriority[left.status] - statusPriority[right.status]
      || right.noResultSearches - left.noResultSearches
      || right.searches - left.searches
      || left.label.localeCompare(right.label, 'en-GB')
    ))
    .slice(0, 10);
};

const countFacet = (...conditions) => [
  { $match: { $and: conditions } },
  { $count: 'count' },
];

export const getOnboardingAnalytics = async ({
  asOf = new Date(),
  UserModel = User,
  ProfileModel = Profile,
} = {}) => {
  const activePaid = buildActivePaidMemberQuery(asOf);
  const profileExists = { 'profile._id': { $exists: true } };
  const tutorialCompleted = { 'profile.onboardingTutorial.isCompleted': true };
  const coreDetailsAdded = {
    $and: [
      { 'profile.description': { $type: 'string', $regex: /\S/ } },
      { 'profile.location': { $type: 'string', $regex: /\S/ } },
      {
        $or: [
          { 'profile.specialisation': { $type: 'string', $regex: /\S/ } },
          { 'profile.specialisationOne': { $type: 'string', $regex: /\S/ } },
          { 'profile.specialisationTwo': { $type: 'string', $regex: /\S/ } },
          { 'profile.specialisationThree': { $type: 'string', $regex: /\S/ } },
          { 'profile.specialisationFour': { $type: 'string', $regex: /\S/ } },
        ],
      },
    ],
  };
  const [result = {}] = await UserModel.aggregate([
    { $match: { isAdmin: { $ne: true } } },
    {
      $lookup: {
        from: ProfileModel.collection?.name || 'profiles',
        localField: '_id',
        foreignField: 'user',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $facet: {
        registered: [{ $count: 'count' }],
        emailVerified: countFacet({ isConfirmed: true }),
        activePaid: countFacet(activePaid),
        profileCreated: countFacet(activePaid, profileExists),
        tutorialCompleted: countFacet(
          activePaid,
          profileExists,
          tutorialCompleted,
        ),
        coreDetailsAdded: countFacet(
          activePaid,
          profileExists,
          tutorialCompleted,
          coreDetailsAdded,
        ),
        qualificationApproved: countFacet(
          activePaid,
          profileExists,
          tutorialCompleted,
          coreDetailsAdded,
          { 'profile.qualificationVerificationStatus': 'approved' },
        ),
      },
    },
  ]);

  const countFor = (key) => result[key]?.[0]?.count || 0;
  const stageDefinitions = [
    ['registered', 'Registered', 'Current non-admin accounts'],
    ['emailVerified', 'Email verified', 'Confirmed email address'],
    ['activePaid', 'Active paid', 'Current subscription access'],
    ['profileCreated', 'Profile created', 'Professional profile record exists'],
    ['tutorialCompleted', 'Tutorial completed', 'Required onboarding interaction completed'],
    ['coreDetailsAdded', 'Core details added', 'Description, location and specialisation supplied'],
    ['qualificationApproved', 'Qualification approved', 'Current qualification summary approved'],
  ];
  const registered = countFor('registered');
  let previousCount = registered;
  const stages = stageDefinitions.map(([key, label, definition]) => {
    const count = countFor(key);
    const stage = {
      key,
      label,
      definition,
      count,
      percentOfRegistered: registered
        ? Math.round((count / registered) * 100)
        : 0,
      dropOffFromPrevious: Math.max(previousCount - count, 0),
    };
    previousCount = count;
    return stage;
  });

  return {
    available: true,
    cohort: 'current_non_admin_members',
    asOf: asOf.toISOString(),
    stages,
    limitations: [
      'This is a current-state cumulative funnel, not a historical transition ledger.',
      'Checkout-created and unconfirmed accounts are included at registration.',
    ],
  };
};

export const getSearchAnalytics = async ({
  asOf = new Date(),
  days = 30,
  SearchEventModel = SearchEvent,
  UserModel = User,
  ProfileModel = Profile,
} = {}) => {
  const since = new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000);
  const [
    professionDemand,
    locationDemand,
    professionSupply,
    locationSupply,
    topKeywords,
    noResultSearches,
    totalSearches,
    firstEvent,
  ] = await Promise.all([
    demandDimension('professionKey', since, SearchEventModel),
    demandDimension('locationKey', since, SearchEventModel),
    supplyDimension('specialisation', ProfileModel, UserModel),
    supplyDimension('location', ProfileModel, UserModel),
    SearchEventModel.aggregate([
      { $match: { occurredAt: { $gte: since } } },
      { $unwind: '$keywordTokens' },
      { $group: { _id: '$keywordTokens', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 10 },
      { $project: { _id: 0, label: '$_id', count: 1 } },
    ]),
    SearchEventModel.countDocuments({ occurredAt: { $gte: since }, resultsCount: 0 }),
    SearchEventModel.countDocuments({ occurredAt: { $gte: since } }),
    SearchEventModel.findOne({}).sort({ occurredAt: 1 }).select('occurredAt').lean(),
  ]);
  return {
    available: true,
    windowDays: days,
    completeFrom: firstEvent?.occurredAt || null,
    totalSearches,
    noResultSearches,
    topProfessions: professionDemand.slice(0, 10).map((row) => ({
      label: row._id,
      count: row.searches,
    })),
    topLocations: locationDemand.slice(0, 10).map((row) => ({
      label: row._id,
      count: row.searches,
    })),
    topKeywords,
    demandSupply: {
      professions: buildDemandSupplyRows(professionDemand, professionSupply),
      locations: buildDemandSupplyRows(locationDemand, locationSupply),
      supplyDefinition: 'Currently discoverable profiles with an exact normalized field match',
    },
  };
};

export const getMembershipAnalytics = async ({
  asOf = new Date(),
  months = 12,
  timeZone = 'Europe/London',
  UserModel = User,
  ProfileModel = Profile,
} = {}) => {
  const boundaries = getCalendarBoundaries(asOf, timeZone);
  const monthWindow = getMonthWindow(asOf, months, timeZone);
  const nonAdmin = { isAdmin: { $ne: true } };
  const activePaid = buildActivePaidMemberQuery(asOf);
  const expired = {
    ...nonAdmin,
    $and: [
      { $or: [{ stripeCustomerId: { $exists: true, $ne: null } }, { stripeSubscriptionId: { $exists: true, $ne: null } }] },
      { $or: [{ currentPeriodEnd: { $lte: asOf } }, { paymentStatus: { $in: INACTIVE_STATUSES } }] },
    ],
  };
  const pendingVerificationPromise = ProfileModel.aggregate([
    { $match: { qualificationVerificationStatus: 'pending' } },
    {
      $lookup: {
        from: UserModel.collection?.name || 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'owner',
      },
    },
    { $unwind: '$owner' },
    { $match: { 'owner.isAdmin': { $ne: true } } },
    { $count: 'count' },
  ]);

  const [total, active, pendingVerificationRows, disabled, expiredCount, today, week, month, monthlyNew, beforeWindow] = await Promise.all([
    UserModel.countDocuments(nonAdmin),
    UserModel.countDocuments(activePaid),
    pendingVerificationPromise,
    UserModel.countDocuments({ ...nonAdmin, publicProfileStatus: 'disabled' }),
    UserModel.countDocuments(expired),
    UserModel.countDocuments({ ...nonAdmin, createdAt: { $gte: boundaries.day, $lte: asOf } }),
    UserModel.countDocuments({ ...nonAdmin, createdAt: { $gte: boundaries.week, $lte: asOf } }),
    UserModel.countDocuments({ ...nonAdmin, createdAt: { $gte: boundaries.month, $lte: asOf } }),
    UserModel.aggregate([
      { $match: { ...nonAdmin, createdAt: { $gte: monthWindow.start, $lte: asOf } } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m', timezone: timeZone } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    UserModel.countDocuments({ ...nonAdmin, createdAt: { $lt: monthWindow.start } }),
  ]);

  const additions = new Map(monthlyNew.map((row) => [row._id, row.count]));
  let runningTotal = beforeWindow;
  const growth = monthWindow.labels.map((label) => {
    const registrations = additions.get(label) || 0;
    runningTotal += registrations;
    return { month: label, registrations, total: runningTotal };
  });

  return {
    asOf: asOf.toISOString(),
    timezone: timeZone,
    totalRegistered: total,
    activePaidMembers: active,
    pendingQualificationVerification: pendingVerificationRows[0]?.count || 0,
    disabledPublicProfiles: disabled,
    expiredSubscriptions: expiredCount,
    registrations: { today, week, month },
    growth,
    limitations: ['Hard-deleted users are absent from historical totals.'],
  };
};
