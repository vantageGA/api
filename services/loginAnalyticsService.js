import LoginEvent from '../models/loginEventModel.js';
import User from '../models/userModel.js';
import { buildActivePaidMemberQuery } from '../utils/analyticsQueries.js';
import { getCalendarBoundaries, getMonthWindow } from '../utils/timezone.js';

export const LOGIN_EVENT_RETENTION_DAYS = 400;
export const MEMBER_HEALTH_THRESHOLDS_DAYS = Object.freeze({
  healthy: 7,
  occasional: 30,
  slipping: 60,
});

export const recordMemberLogin = async (userId, {
  LoginEventModel = LoginEvent,
  UserModel = User,
  now = new Date(),
  retentionDays = LOGIN_EVENT_RETENTION_DAYS,
} = {}) => Promise.all([
  LoginEventModel.create({
    userId,
    accountType: 'member',
    occurredAt: now,
    expiresAt: new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000),
  }),
  UserModel.updateOne(
    { _id: userId, isAdmin: { $ne: true } },
    { $max: { lastSuccessfulLoginAt: now } },
  ),
]);

const memberIdsSince = (since, asOf, LoginEventModel, additionalMatch = {}) => (
  LoginEventModel.distinct('userId', {
    accountType: 'member',
    occurredAt: { $gte: since, $lte: asOf },
    ...additionalMatch,
  })
);

const uniqueMembersSince = async (since, asOf, LoginEventModel, additionalMatch = {}) => (
  (await memberIdsSince(since, asOf, LoginEventModel, additionalMatch)).length
);

const memberIdentity = (user) => ({
  memberId: String(user._id),
  name: user.name,
  email: user.email,
});

const prefixQueryFields = (query, prefix) => Object.fromEntries(
  Object.entries(query).map(([key, value]) => {
    if (key.startsWith('$')) {
      return [
        key,
        Array.isArray(value)
          ? value.map((entry) => prefixQueryFields(entry, prefix))
          : value,
      ];
    }
    return [`${prefix}.${key}`, value];
  }),
);

export const getMemberLoginAnalytics = async ({
  asOf = new Date(),
  months = 12,
  timeZone = 'Europe/London',
  UserModel = User,
  LoginEventModel = LoginEvent,
  captureStartedAt = process.env.LOGIN_ANALYTICS_STARTED_AT
    ? new Date(process.env.LOGIN_ANALYTICS_STARTED_AT)
    : null,
} = {}) => {
  const authoritativeCaptureStartedAt = (
    captureStartedAt instanceof Date
    && !Number.isNaN(captureStartedAt.getTime())
  ) ? captureStartedAt : null;
  const boundaries = getCalendarBoundaries(asOf, timeZone);
  const monthWindow = getMonthWindow(asOf, months, timeZone);
  const rolling30Days = new Date(asOf.getTime() - 30 * 24 * 60 * 60 * 1000);
  const activePaidMembers = await UserModel.find(buildActivePaidMemberQuery(asOf))
    .select('_id name email lastSuccessfulLoginAt')
    .lean();
  const activePaidMemberIds = activePaidMembers.map((member) => member._id);
  const activePaidUserMatch = prefixQueryFields(
    buildActivePaidMemberQuery(asOf),
    'member',
  );

  const [
    uniqueToday,
    uniqueWeek,
    uniqueMonth,
    sessionsToday,
    sessionsWeek,
    sessionsMonth,
    monthlyRows,
    mostActiveRows,
    firstEvent,
  ] = await Promise.all([
    uniqueMembersSince(boundaries.day, asOf, LoginEventModel),
    uniqueMembersSince(boundaries.week, asOf, LoginEventModel),
    uniqueMembersSince(boundaries.month, asOf, LoginEventModel),
    LoginEventModel.countDocuments({
      accountType: 'member',
      occurredAt: { $gte: boundaries.day, $lte: asOf },
    }),
    LoginEventModel.countDocuments({
      accountType: 'member',
      occurredAt: { $gte: boundaries.week, $lte: asOf },
    }),
    LoginEventModel.countDocuments({
      accountType: 'member',
      occurredAt: { $gte: boundaries.month, $lte: asOf },
    }),
    LoginEventModel.aggregate([
      {
        $match: {
          accountType: 'member',
          occurredAt: { $gte: monthWindow.start, $lte: asOf },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: '$occurredAt',
              format: '%Y-%m',
              timezone: timeZone,
            },
          },
          sessions: { $sum: 1 },
          memberIds: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          _id: 1,
          sessions: 1,
          uniqueMembers: { $size: '$memberIds' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    LoginEventModel.aggregate([
      {
        $match: {
          accountType: 'member',
          occurredAt: { $gte: rolling30Days, $lte: asOf },
        },
      },
      {
        $group: {
          _id: '$userId',
          sessions30Days: { $sum: 1 },
          lastLoginAt: { $max: '$occurredAt' },
        },
      },
      {
        $lookup: {
          from: UserModel.collection?.name || 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'member',
        },
      },
      { $unwind: '$member' },
      { $match: activePaidUserMatch },
      { $sort: { sessions30Days: -1, lastLoginAt: -1, _id: 1 } },
      { $limit: 10 },
    ]),
    LoginEventModel.findOne({})
      .sort({ occurredAt: 1 })
      .select('occurredAt')
      .lean(),
  ]);

  const monthlyActivity = new Map(monthlyRows.map((row) => [row._id, row]));
  const trend = monthWindow.labels.map((month) => ({
    month,
    sessions: monthlyActivity.get(month)?.sessions || 0,
    uniqueMembers: monthlyActivity.get(month)?.uniqueMembers || 0,
  }));
  const activePaidSeen30DayIds = activePaidMembers
    .filter((member) => {
      const lastLoginAt = member.lastSuccessfulLoginAt
        ? new Date(member.lastSuccessfulLoginAt)
        : null;
      return (
        lastLoginAt
        && lastLoginAt >= rolling30Days
        && lastLoginAt <= asOf
      );
    })
    .map((member) => member._id);
  const seenActivePaidIds = new Set(activePaidSeen30DayIds.map(String));
  const inactivePaidMemberIds = activePaidMemberIds.filter(
    (memberId) => !seenActivePaidIds.has(String(memberId)),
  );
  const users = activePaidMembers;
  const usersById = new Map(users.map((user) => [String(user._id), user]));
  const lastLoginById = new Map(
    users.map((user) => [String(user._id), user.lastSuccessfulLoginAt]),
  );
  const healthCounts = {
    healthy: 0,
    occasional: 0,
    slipping: 0,
    atRisk: 0,
    unmeasured: 0,
  };
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  activePaidMemberIds.forEach((memberId) => {
    const lastLoginAt = lastLoginById.get(String(memberId));
    if (!lastLoginAt) {
      healthCounts.unmeasured += 1;
      return;
    }
    const daysSinceLogin = Math.max(
      0,
      (asOf.getTime() - new Date(lastLoginAt).getTime()) / dayInMilliseconds,
    );
    if (daysSinceLogin <= MEMBER_HEALTH_THRESHOLDS_DAYS.healthy) {
      healthCounts.healthy += 1;
    } else if (daysSinceLogin <= MEMBER_HEALTH_THRESHOLDS_DAYS.occasional) {
      healthCounts.occasional += 1;
    } else if (daysSinceLogin <= MEMBER_HEALTH_THRESHOLDS_DAYS.slipping) {
      healthCounts.slipping += 1;
    } else {
      healthCounts.atRisk += 1;
    }
  });
  const mostActiveMembers = mostActiveRows.flatMap((row) => {
    const user = usersById.get(String(row._id));
    return user ? [{
      ...memberIdentity(user),
      sessions30Days: row.sessions30Days,
      lastLoginAt: row.lastLoginAt,
    }] : [];
  });
  const inactivePaidMembers = inactivePaidMemberIds
    .flatMap((memberId) => {
      const user = usersById.get(String(memberId));
      return user ? [{
        ...memberIdentity(user),
        lastLoginAt: lastLoginById.get(String(memberId)) || null,
      }] : [];
    })
    .sort((left, right) => {
      if (!left.lastLoginAt && !right.lastLoginAt) {
        return left.name.localeCompare(right.name, 'en-GB');
      }
      if (!left.lastLoginAt) return -1;
      if (!right.lastLoginAt) return 1;
      return new Date(left.lastLoginAt) - new Date(right.lastLoginAt);
    })
    .slice(0, 10);

  return {
    available: true,
    completeFrom: authoritativeCaptureStartedAt,
    firstRetainedEventAt: firstEvent?.occurredAt || null,
    retentionDays: LOGIN_EVENT_RETENTION_DAYS,
    uniqueMembers: {
      today: uniqueToday,
      week: uniqueWeek,
      month: uniqueMonth,
    },
    sessions: {
      today: sessionsToday,
      week: sessionsWeek,
      month: sessionsMonth,
    },
    activePaidSeen30Days: activePaidSeen30DayIds.length,
    activePaidInactive30Days: Math.max(
      activePaidMemberIds.length - activePaidSeen30DayIds.length,
      0,
    ),
    mostActiveMembers,
    inactivePaidMembers,
    health: {
      cohort: 'active_paid_members',
      cohortSize: activePaidMemberIds.length,
      measuredMembers: activePaidMemberIds.length - healthCounts.unmeasured,
      coveragePercent: activePaidMemberIds.length
        ? Math.round(
          ((activePaidMemberIds.length - healthCounts.unmeasured)
            / activePaidMemberIds.length) * 100,
        )
        : 0,
      thresholdsDays: MEMBER_HEALTH_THRESHOLDS_DAYS,
      segments: [
        {
          key: 'healthy',
          label: 'Healthy',
          count: healthCounts.healthy,
          definition: 'Last sign-in within 7 days',
        },
        {
          key: 'occasional',
          label: 'Occasional',
          count: healthCounts.occasional,
          definition: 'Last sign-in 8–30 days ago',
        },
        {
          key: 'slipping',
          label: 'Slipping',
          count: healthCounts.slipping,
          definition: 'Last sign-in 31–60 days ago',
        },
        {
          key: 'atRisk',
          label: 'At risk',
          count: healthCounts.atRisk,
          definition: 'Last captured sign-in more than 60 days ago',
        },
        {
          key: 'unmeasured',
          label: 'Not yet measured',
          count: healthCounts.unmeasured,
          definition: 'No login captured since measurement began',
        },
      ],
    },
    trend,
    limitations: [
      ...(authoritativeCaptureStartedAt
        ? []
        : ['LOGIN_ANALYTICS_STARTED_AT is not configured; the login trend has no authoritative completeness start.']),
      ...(firstEvent
        ? []
        : ['Login measurement starts with this release; earlier logins were not captured.']),
    ],
  };
};
