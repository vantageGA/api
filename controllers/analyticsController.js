import asyncHandler from 'express-async-handler';
import {
  getMembershipAnalytics,
  getOnboardingAnalytics,
  getSearchAnalytics,
  recordSearchEvent,
} from '../services/analyticsService.js';
import { getMemberLoginAnalytics } from '../services/loginAnalyticsService.js';
import { getStripeAnalytics } from '../services/stripeAnalyticsService.js';

export const buildAnalyticsDataQualityWarnings = (membership, revenueResult) => {
  const warnings = [];
  if (
    revenueResult.available
    && membership.activePaidMembers > 0
    && revenueResult.subscriptionCounts?.activeOrTrialing !== membership.activePaidMembers
  ) {
    warnings.push(
      `MongoDB reports ${membership.activePaidMembers} active paid members, while the configured Stripe account returned ${revenueResult.subscriptionCounts?.activeOrTrialing || 0} active or trialing subscriptions. Check that the API uses the matching Stripe account and reconcile stored subscription identifiers.`,
    );
  }
  if (revenueResult.available && revenueResult.currencies?.length > 1) {
    warnings.push(
      `Stripe returned ${revenueResult.currencies.length} currencies. Review each currency separately; values must not be combined without an explicit conversion policy.`,
    );
  }
  if (revenueResult.stale) {
    warnings.push(
      'Stripe analytics could not be refreshed, so the dashboard is showing stale cached financial data.',
    );
  }
  return warnings;
};

export const captureSearchEvent = asyncHandler(async (req, res) => {
  try {
    await recordSearchEvent(req.body);
  } catch (error) {
    if (error?.code === 'INVALID_SEARCH_ANALYTICS_RECEIPT') {
      res.status(400);
    }
    throw error;
  }
  res.status(202).json({ accepted: true });
});

export const getAnalyticsOverview = asyncHandler(async (req, res) => {
  const asOf = new Date();
  const [membership, engagement, onboarding, search, revenueResult] = await Promise.all([
    getMembershipAnalytics({
      asOf,
      months: req.query.months,
      timeZone: req.query.timezone,
    }),
    getMemberLoginAnalytics({
      asOf,
      months: req.query.months,
      timeZone: req.query.timezone,
    }),
    getOnboardingAnalytics({ asOf }),
    getSearchAnalytics({ asOf, days: req.query.searchDays }),
    getStripeAnalytics({
      asOf,
      timeZone: req.query.timezone,
    }).catch(() => ({
      available: false,
      reason: 'Stripe revenue data is temporarily unavailable.',
    })),
  ]);

  const dataQualityWarnings = buildAnalyticsDataQualityWarnings(
    membership,
    revenueResult,
  );

  const generatedAt = new Date();
  res.json({
    generatedAt: generatedAt.toISOString(),
    asOf: asOf.toISOString(),
    timezone: req.query.timezone,
    membership,
    engagement,
    onboarding,
    revenue: revenueResult,
    search,
    dataQualityWarnings,
  });
});
