import Joi from 'joi';

export const analyticsOverviewQuerySchema = Joi.object({
  months: Joi.number().integer().min(1).max(24).default(12),
  searchDays: Joi.number().integer().min(1).max(365).default(30),
  timezone: Joi.string().valid('Europe/London').default('Europe/London'),
});

export const searchEventSchema = Joi.object({
  eventId: Joi.string().trim().max(100).required(),
  sessionId: Joi.string().trim().max(100).required(),
  source: Joi.string().valid('homepage', 'directory').default('homepage'),
  receipt: Joi.string().trim().max(2000).required(),
});
