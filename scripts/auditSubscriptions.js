import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Stripe from 'stripe';
import User from '../models/userModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const activeStripeStatuses = new Set(['active', 'trialing']);

const issueCounts = {};

const incrementIssueCount = (issue) => {
  issueCounts[issue] = (issueCounts[issue] || 0) + 1;
};

const serializeUser = (user) => ({
  userId: user._id.toString(),
  name: user.name,
  email: user.email,
  isSubscribed: user.isSubscribed,
  paymentStatus: user.paymentStatus,
  stripeCustomerId: user.stripeCustomerId || null,
  stripeSubscriptionId: user.stripeSubscriptionId || null,
  plan: user.plan || null,
  currentPeriodEnd: user.currentPeriodEnd || null,
});

const addIssue = (issues, user, issue, details = {}) => {
  incrementIssueCount(issue);
  issues.push({
    issue,
    ...serializeUser(user),
    details,
  });
};

const getActiveSubscription = (subscriptions = []) =>
  subscriptions.find((subscription) => activeStripeStatuses.has(subscription.status));

const getStripeSubscription = async (stripe, subscriptionId) => {
  try {
    return {
      subscription: await stripe.subscriptions.retrieve(subscriptionId),
      error: null,
    };
  } catch (error) {
    return {
      subscription: null,
      error: {
        code: error.code || null,
        type: error.type || null,
        message: error.message,
      },
    };
  }
};

const listStripeSubscriptions = async (stripe, customerId) => {
  try {
    const response = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    });

    return {
      subscriptions: response.data || [],
      error: null,
    };
  } catch (error) {
    return {
      subscriptions: [],
      error: {
        code: error.code || null,
        type: error.type || null,
        message: error.message,
      },
    };
  }
};

const getCustomerListIssue = (error) => {
  if (error?.code === 'resource_missing' && error?.message?.includes('No such customer')) {
    return 'DB_STRIPE_CUSTOMER_ID_NOT_FOUND_IN_STRIPE';
  }

  return 'STRIPE_CUSTOMER_SUBSCRIPTION_LIST_FAILED';
};

const getSubscriptionRetrieveIssue = (error) => {
  if (
    error?.code === 'resource_missing' &&
    error?.message?.includes('No such subscription')
  ) {
    return 'DB_STRIPE_SUBSCRIPTION_ID_NOT_FOUND_IN_STRIPE';
  }

  return 'STRIPE_SUBSCRIPTION_RETRIEVE_FAILED';
};

const runAudit = async () => {
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is required');
  }

  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }

  const stripe = new Stripe(stripeSecretKey);
  const startedAt = new Date();

  await mongoose.connect(mongoUri);

  const users = await User.find({
    $or: [
      { isSubscribed: true },
      { stripeCustomerId: { $exists: true, $ne: null } },
      { stripeSubscriptionId: { $exists: true, $ne: null } },
      { paymentStatus: { $in: ['active', 'failed', 'canceled'] } },
    ],
  })
    .select('name email isSubscribed paymentStatus stripeCustomerId stripeSubscriptionId plan currentPeriodEnd')
    .lean();

  const issues = [];
  let stripeSubscriptionChecks = 0;
  let stripeCustomerChecks = 0;
  const usersByPaymentStatus = {};

  for (const user of users) {
    const status = user.paymentStatus || 'missing';
    usersByPaymentStatus[status] = (usersByPaymentStatus[status] || 0) + 1;
  }

  for (const user of users) {
    const currentPeriodEnd = user.currentPeriodEnd
      ? new Date(user.currentPeriodEnd).getTime()
      : null;

    if (user.isSubscribed && !user.stripeSubscriptionId) {
      addIssue(issues, user, 'DB_SUBSCRIBED_WITHOUT_STRIPE_SUBSCRIPTION_ID');
    }

    if (user.isSubscribed && !user.stripeCustomerId) {
      addIssue(issues, user, 'DB_SUBSCRIBED_WITHOUT_STRIPE_CUSTOMER_ID');
    }

    if (user.isSubscribed && user.paymentStatus && user.paymentStatus !== 'active') {
      addIssue(issues, user, 'DB_SUBSCRIBED_WITH_NON_ACTIVE_PAYMENT_STATUS');
    }

    if (user.isSubscribed && currentPeriodEnd && currentPeriodEnd <= Date.now()) {
      addIssue(issues, user, 'DB_SUBSCRIBED_WITH_EXPIRED_PERIOD');
    }

    let stripeSubscription = null;
    if (user.stripeSubscriptionId) {
      stripeSubscriptionChecks += 1;
      const { subscription, error } = await getStripeSubscription(
        stripe,
        user.stripeSubscriptionId,
      );

      if (error) {
        addIssue(issues, user, getSubscriptionRetrieveIssue(error), error);
      } else {
        stripeSubscription = subscription;

        if (!activeStripeStatuses.has(subscription.status) && user.isSubscribed) {
          addIssue(issues, user, 'DB_SUBSCRIBED_BUT_STRIPE_SUBSCRIPTION_INACTIVE', {
            stripeStatus: subscription.status,
          });
        }

        if (
          user.stripeCustomerId &&
          subscription.customer &&
          subscription.customer !== user.stripeCustomerId
        ) {
          addIssue(issues, user, 'STRIPE_SUBSCRIPTION_CUSTOMER_MISMATCH', {
            subscriptionCustomerId: subscription.customer,
          });
        }
      }
    }

    if (user.stripeCustomerId) {
      stripeCustomerChecks += 1;
      const { subscriptions, error } = await listStripeSubscriptions(
        stripe,
        user.stripeCustomerId,
      );

      if (error) {
        addIssue(issues, user, getCustomerListIssue(error), error);
      } else {
        const activeSubscription = getActiveSubscription(subscriptions);

        if (!user.isSubscribed && activeSubscription) {
          addIssue(issues, user, 'DB_INACTIVE_BUT_STRIPE_SUBSCRIPTION_ACTIVE', {
            stripeSubscriptionId: activeSubscription.id,
            stripeStatus: activeSubscription.status,
          });
        }

        if (
          user.isSubscribed &&
          !activeSubscription &&
          !activeStripeStatuses.has(stripeSubscription?.status)
        ) {
          addIssue(issues, user, 'DB_SUBSCRIBED_BUT_NO_ACTIVE_STRIPE_SUBSCRIPTION');
        }
      }
    }
  }

  const report = {
    generatedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    readOnly: true,
    totals: {
      usersChecked: users.length,
      usersWithIsSubscribedTrue: users.filter((user) => user.isSubscribed).length,
      usersWithStripeCustomerId: users.filter((user) => user.stripeCustomerId).length,
      usersWithStripeSubscriptionId: users.filter((user) => user.stripeSubscriptionId).length,
      issuesFound: issues.length,
      stripeSubscriptionChecks,
      stripeCustomerChecks,
    },
    usersByPaymentStatus,
    issueCounts,
    issues,
  };

  const reportsDir = path.resolve(__dirname, '../reports');
  await fs.mkdir(reportsDir, { recursive: true });

  const reportPath = path.join(
    reportsDir,
    `subscription-audit-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`,
  );

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('Subscription audit completed.');
  console.log(`Users checked: ${report.totals.usersChecked}`);
  console.log(`Users with isSubscribed true: ${report.totals.usersWithIsSubscribedTrue}`);
  console.log(`Users with Stripe customer ID: ${report.totals.usersWithStripeCustomerId}`);
  console.log(`Users with Stripe subscription ID: ${report.totals.usersWithStripeSubscriptionId}`);
  console.log(`Issues found: ${report.totals.issuesFound}`);
  console.log(`Stripe subscription checks: ${report.totals.stripeSubscriptionChecks}`);
  console.log(`Stripe customer checks: ${report.totals.stripeCustomerChecks}`);
  console.log('Issue counts:');
  for (const [issue, count] of Object.entries(issueCounts)) {
    console.log(`- ${issue}: ${count}`);
  }
  console.log(`Report written to: ${reportPath}`);
};

try {
  await runAudit();
} catch (error) {
  console.error(`Subscription audit failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
