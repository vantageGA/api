import stripe from '../config/stripe.js';
import User from '../models/userModel.js';

export const getOrCreateStripeCustomer = async (user) => {
  if (user.stripeCustomerId) {
    // Verify that the customer actually exists in Stripe
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
      return user.stripeCustomerId;
    } catch (error) {
      console.error('Stripe customer not found, creating new:', error.message);
      user.stripeCustomerId = null;
      await user.save();
    }
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { mongoId: String(user._id) },
  });

  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
};

export const createCheckoutSession = async (user, plan) => {
  const customerId = await getOrCreateStripeCustomer(user);

  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer: customerId,
    line_items: [
      { price: priceId, quantity: 1 }
    ],
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId: String(user._id) }
    },
    success_url: `${process.env.FRONTEND_URL}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/subscribe/cancel`
  });

  return session;
};

export const createSubscription = async (user, plan, paymentMethodId) => {
  const customerId = await getOrCreateStripeCustomer(user);

  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId }
  });

  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: {
      payment_method_types: ['card'],
      save_default_payment_method: 'on_subscription'
    },
    expand: ['latest_invoice.payment_intent'],
    metadata: { userId: String(user._id), plan }
  });

  return subscription;
};
