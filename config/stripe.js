import dotenv from 'dotenv';
// Ensure environment variables are loaded
dotenv.config();

import stripe from 'stripe';

// Initialize Stripe only if secret key is available
let stripeInstance;

if (process.env.STRIPE_SECRET_KEY) {
  stripeInstance = stripe(process.env.STRIPE_SECRET_KEY);
  stripeInstance.__isConfigured = true;
  console.log('✅ Stripe integration initialized');
} else {
  console.warn('⚠️  Stripe integration disabled - STRIPE_SECRET_KEY not provided');
  // Create a mock instance for development purposes
  stripeInstance = {
    __isConfigured: false,
    customers: { 
      create: () => Promise.resolve({ id: 'mock-customer-id' }),
      retrieve: () => Promise.resolve({ id: 'mock-customer-id' })
    },
    checkout: {
      sessions: {
        create: () => Promise.resolve({ url: `${process.env.FRONTEND_URL}/subscribe/success?session_id=mock-checkout-session-id` }),
        retrieve: () => Promise.resolve({
          customer: 'mock-customer-id',
          subscription: 'mock-subscription-id',
        }),
      },
    },
    subscriptions: { 
      create: () => Promise.resolve({ id: 'mock-subscription-id' }), 
      retrieve: () => Promise.resolve({
        id: 'mock-subscription-id',
        status: 'active',
        customer: 'mock-customer-id',
        items: { data: [{ price: { id: 'mock-price-id' } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      }),
      list: () => Promise.resolve({ data: [] }),
    },
    invoices: {
      list: () => Promise.resolve({ data: [], has_more: false }),
    },
    paymentMethods: { attach: () => Promise.resolve() },
    webhooks: { constructEvent: () => Promise.resolve({ type: 'mock-event', data: { object: {} } }) }
  };
}

export default stripeInstance;
