import stripe from '../config/stripe.js';
import User from '../models/userModel.js';

export const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const payload = req.body;

  let event;

  try {
    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('⚠️  Webhook signature verification failed.', err.message);
    return res.status(400).send('Invalid signature');
  }

  const data = event.data.object;
  const eventType = event.type;

  console.log(`Webhook event received: ${eventType}`);

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        const session = data;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.isSubscribed = true;
          user.stripeSubscriptionId = subscriptionId;
          
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          user.plan = sub.items.data[0].price.id;
          user.currentPeriodEnd = new Date(sub.current_period_end * 1000);
          await user.save();
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = data;
        const customerId = invoice.customer;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.isSubscribed = true;
          if (invoice.subscription) {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription);
            user.currentPeriodEnd = new Date(sub.current_period_end * 1000);
            user.plan = sub.items.data[0].price.id;
          }
          await user.save();
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = data;
        const customerId = invoice.customer;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.paymentStatus = 'failed';
          await user.save();
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = data;
        const customerId = subscription.customer;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.isSubscribed = false;
          user.paymentStatus = 'canceled';
          await user.save();
        }
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = data;
        const customerId = subscription.customer;

        const user = await User.findOne({ stripeCustomerId: customerId });
        if (user) {
          user.isSubscribed = (subscription.status === 'active' || subscription.status === 'trialing');
          user.plan = subscription.items.data[0].price.id;
          user.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
          await user.save();
        }
        break;
      }
      default:
        console.log(`Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).send('Webhook handler failed');
  }

  res.sendStatus(200);
};
