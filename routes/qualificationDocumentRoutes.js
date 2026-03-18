import express from 'express';
import {
  getQualificationDocuments,
  uploadQualificationDocument,
  replaceQualificationDocument,
  deleteQualificationDocument,
  getQualificationDocumentsAdmin,
  reviewQualificationDocument,
} from '../controllers/qualificationDocumentController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { handleQualificationDocumentUpload } from '../middleware/qualificationDocumentUploadMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import {
  qualificationDocumentIdSchema,
  qualificationDocumentListQuerySchema,
  qualificationDocumentReviewSchema,
} from '../validators/qualificationDocumentValidator.js';
import {
  qualificationDocumentMutationLimiter,
  qualificationDocumentReviewLimiter,
} from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// Authenticated user qualification document routes
router
  .route('/profile/qualification-documents')
  .get(protect, validate(qualificationDocumentListQuerySchema, 'query'), getQualificationDocuments)
  .post(
    protect,
    qualificationDocumentMutationLimiter,
    handleQualificationDocumentUpload,
    uploadQualificationDocument,
  );

router
  .route('/profile/qualification-documents/:id')
  .put(
    protect,
    qualificationDocumentMutationLimiter,
    validate(qualificationDocumentIdSchema, 'params'),
    handleQualificationDocumentUpload,
    replaceQualificationDocument,
  )
  .delete(
    protect,
    qualificationDocumentMutationLimiter,
    validate(qualificationDocumentIdSchema, 'params'),
    deleteQualificationDocument,
  );

// Admin qualification document review routes
router
  .route('/profiles/admin/qualification-documents')
  .get(
    protect,
    admin,
    validate(qualificationDocumentListQuerySchema, 'query'),
    getQualificationDocumentsAdmin,
  );

router
  .route('/profiles/admin/qualification-documents/:id/review')
  .patch(
    protect,
    admin,
    qualificationDocumentReviewLimiter,
    validate(qualificationDocumentIdSchema, 'params'),
    validate(qualificationDocumentReviewSchema),
    reviewQualificationDocument,
  );

export default router;
