import express from 'express';
import { captureSearchEvent, getAnalyticsOverview } from '../controllers/analyticsController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { searchAnalyticsLimiter } from '../middleware/rateLimitMiddleware.js';
import { analyticsOverviewQuerySchema, searchEventSchema } from '../validators/analyticsValidator.js';

const router = express.Router();

router.post(
  '/analytics/search-events',
  searchAnalyticsLimiter,
  validate(searchEventSchema),
  captureSearchEvent,
);

router.get(
  '/admin/analytics/overview',
  protect,
  admin,
  validate(analyticsOverviewQuerySchema, 'query'),
  getAnalyticsOverview,
);

export default router;
