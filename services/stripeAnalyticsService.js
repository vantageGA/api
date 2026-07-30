import stripe from '../config/stripe.js';
import { getCalendarBoundaries } from '../utils/timezone.js';
import { logError } from '../utils/auditLogger.js';

const CACHE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
let cachedRevenue = null;

const listAll = async (list, params) => {
  const rows = [];
  let startingAfter;
  do {
    const page = await list({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    rows.push(...page.data);
    const nextCursor = page.has_more ? page.data.at(-1)?.id : null;
    if (page.has_more && (!nextCursor || nextCursor === startingAfter)) {
      throw new Error('Stripe pagination returned no forward cursor.');
    }
    startingAfter = nextCursor;
  } while (startingAfter);
  return rows;
};

const withTimeout = (promise, timeoutMs) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    const error = new Error('Stripe analytics request timed out.');
    error.code = 'STRIPE_ANALYTICS_TIMEOUT';
    reject(error);
  }, timeoutMs);

  promise.then(
    (value) => {
      clearTimeout(timeout);
      resolve(value);
    },
    (error) => {
      clearTimeout(timeout);
      reject(error);
    },
  );
});

const addCurrency = (map, currency, field, amount) => {
  const key = String(currency || 'unknown').toLowerCase();
  const row = map.get(key) || {
    currency: key,
    monthToDateMinor: 0,
    yearToDateMinor: 0,
    outstandingMinor: 0,
  };
  row[field] += Number(amount) || 0;
  map.set(key, row);
};

export const getStripeAnalytics = async ({
  asOf = new Date(),
  timeZone = 'Europe/London',
  stripeClient = stripe,
  bypassCache = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onError = logError,
} = {}) => {
  if (!bypassCache && cachedRevenue && cachedRevenue.expiresAt > Date.now()) {
    return { ...cachedRevenue.value, cached: true };
  }
  if (
    stripeClient?.__isConfigured === false
    || !stripeClient?.invoices?.list
    || !stripeClient?.subscriptions?.list
  ) {
    return { available: false, reason: 'Stripe analytics is not configured.' };
  }

  const boundaries = getCalendarBoundaries(asOf, timeZone);
  let paidInvoices;
  let openInvoices;
  let subscriptions;
  try {
    [paidInvoices, openInvoices, subscriptions] = await withTimeout(
      Promise.all([
        listAll(stripeClient.invoices.list.bind(stripeClient.invoices), {
          status: 'paid',
        }),
        listAll(stripeClient.invoices.list.bind(stripeClient.invoices), { status: 'open' }),
        listAll(stripeClient.subscriptions.list.bind(stripeClient.subscriptions), { status: 'all' }),
      ]),
      timeoutMs,
    );
  } catch (error) {
    try {
      onError('Stripe analytics refresh failed', error, {
        operation: 'admin_analytics_overview',
      });
    } catch {
      // Reporting must not replace the original Stripe failure.
    }
    if (cachedRevenue) {
      return {
        ...cachedRevenue.value,
        cached: true,
        stale: true,
        reason: 'Showing the most recent cached Stripe analytics.',
      };
    }
    throw error;
  }

  const currencies = new Map();
  for (const invoice of paidInvoices) {
    const isSubscriptionInvoice = Boolean(
      invoice.subscription
      || (
        invoice.parent?.type === 'subscription_details'
        && invoice.parent.subscription_details?.subscription
      ),
    );
    if (!isSubscriptionInvoice) continue;
    const paidAtSeconds = Number(invoice.status_transitions?.paid_at);
    if (!Number.isFinite(paidAtSeconds) || paidAtSeconds <= 0) continue;
    const paidAt = new Date(paidAtSeconds * 1000);
    if (paidAt >= boundaries.year && paidAt <= asOf) {
      addCurrency(currencies, invoice.currency, 'yearToDateMinor', invoice.amount_paid);
    }
    if (paidAt >= boundaries.month && paidAt <= asOf) {
      addCurrency(currencies, invoice.currency, 'monthToDateMinor', invoice.amount_paid);
    }
  }
  for (const invoice of openInvoices) {
    const isSubscriptionInvoice = Boolean(
      invoice.subscription
      || (
        invoice.parent?.type === 'subscription_details'
        && invoice.parent.subscription_details?.subscription
      ),
    );
    if (!isSubscriptionInvoice) continue;
    addCurrency(currencies, invoice.currency, 'outstandingMinor', invoice.amount_remaining);
  }

  const renewalCutoff = asOf.getTime() + 30 * 24 * 60 * 60 * 1000;
  const renewalsDue30Days = subscriptions.filter((subscription) => (
    (() => {
      const periodEnds = (subscription.items?.data || [])
        .map((item) => Number(item.current_period_end) * 1000)
        .filter(Number.isFinite);
      const nextPeriodEnd = periodEnds.length ? Math.min(...periodEnds) : null;
      return (
        ['active', 'trialing'].includes(subscription.status)
        && !subscription.cancel_at_period_end
        && nextPeriodEnd >= asOf.getTime()
        && nextPeriodEnd <= renewalCutoff
      );
    })()
  )).length;

  const value = {
    available: true,
    stale: false,
    asOf: asOf.toISOString(),
    currencies: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    subscriptionCounts: {
      total: subscriptions.length,
      activeOrTrialing: subscriptions.filter((subscription) =>
        ['active', 'trialing'].includes(subscription.status)).length,
    },
    renewalsDue30Days,
  };
  cachedRevenue = { value, expiresAt: Date.now() + CACHE_MS };
  return { ...value, cached: false };
};

export const clearStripeAnalyticsCache = () => {
  cachedRevenue = null;
};
