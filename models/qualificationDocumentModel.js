import mongoose from 'mongoose';

const QUALIFICATION_DOCUMENT_STATUSES = [
  'pending',
  'approved',
  'rejected',
];

const QUALIFICATION_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

const QUALIFICATION_DOCUMENT_RESOURCE_TYPES = [
  'image',
  'raw',
];

const qualificationDocumentSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    profile: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Profile',
    },
    originalFileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    mimeType: {
      type: String,
      required: true,
      enum: QUALIFICATION_DOCUMENT_MIME_TYPES,
    },
    fileSizeBytes: {
      type: Number,
      required: true,
      min: 1,
      max: 5 * 1024 * 1024,
    },
    cloudinaryPublicId: {
      type: String,
      required: true,
      trim: true,
    },
    cloudinaryResourceType: {
      type: String,
      required: true,
      enum: QUALIFICATION_DOCUMENT_RESOURCE_TYPES,
      default: 'raw',
    },
    status: {
      type: String,
      enum: QUALIFICATION_DOCUMENT_STATUSES,
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    supersededAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

qualificationDocumentSchema.index({ profile: 1, isActive: 1 });
qualificationDocumentSchema.index({ user: 1, createdAt: -1 });
qualificationDocumentSchema.index({ status: 1, createdAt: -1 });
qualificationDocumentSchema.index({ reviewedBy: 1, reviewedAt: -1 });

const QualificationDocument = mongoose.model(
  'QualificationDocument',
  qualificationDocumentSchema,
);

export default QualificationDocument;
