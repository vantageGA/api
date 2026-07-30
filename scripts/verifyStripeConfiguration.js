import dotenv from 'dotenv';
import Stripe from 'stripe';
import {
  getStripeConfigurationWarnings,
  stripeKeyMode,
} from '../config/validateEnv.js';

dotenv.config({ quiet: true });

const warnings = getStripeConfigurationWarnings(process.env);
if (warnings.length) {
  warnings.forEach((warning) => console.error(`Configuration error: ${warning}`));
  process.exitCode = 1;
} else if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Configuration error: STRIPE_SECRET_KEY is missing.');
  process.exitCode = 1;
} else {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const priceNames = ['STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_ANNUAL'];

  try {
    const account = await stripe.accounts.retrieve();
    const prices = await Promise.all(priceNames.map(async (name) => ({
      name,
      price: await stripe.prices.retrieve(process.env[name]),
    })));
    const currencies = [...new Set(prices.map(({ price }) => price.currency))];
    const inactive = prices.filter(({ price }) => !price.active).map(({ name }) => name);

    console.log(`Stripe mode: ${stripeKeyMode(process.env.STRIPE_SECRET_KEY)}`);
    console.log(`Stripe account reachable: ${Boolean(account?.id)}`);
    console.log(`Configured prices reachable: ${prices.length}/${priceNames.length}`);
    console.log(`Configured price currencies: ${currencies.join(', ')}`);

    if (inactive.length) {
      throw new Error(`${inactive.join(', ')} references an inactive Stripe Price.`);
    }
  } catch (error) {
    console.error(`Stripe configuration verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
