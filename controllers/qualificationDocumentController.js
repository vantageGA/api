import asyncHandler from 'express-async-handler';
import cloudinary from 'cloudinary';
import mongoose from 'mongoose';
import { unlink } from 'fs/promises';
import { Readable } from 'stream';
import Profile from '../models/profileModel.js';
import QualificationDocument from '../models/qualificationDocumentModel.js';
import {
  ALLOWED_QUALIFICATION_DOCUMENT_MIME_TYPES,
  MAX_QUALIFICATION_DOCUMENT_SIZE_BYTES,
} from '../middleware/qualificationDocumentUploadMiddleware.js';
import {
  QUALIFICATION_VERIFICATION_STATUSES,
  saveProfileQualificationSummary,
  syncProfileQualificationSummaryFromActiveDocument,
} from '../utils/profileHelpers.js';
import {
  logError,
  logSecurityEvent,
  SecurityEvents,
} from '../utils/auditLogger.js';
import { validateObjectId } from '../validators/commonValidators.js';

const QUALIFICATION_DOCUMENT_FOLDER = 'qualificationDocuments';
const QUALIFICATION_DOCUMENT_UPLOAD_TIMEOUT_MS = 45000;

const buildQualificationDocumentAuditDetails = ({
  req,
  profile,
  document,
  targetUserId = null,
  replacedDocumentId = null,
  profileStatus = null,
  rejectionReasonProvided = null,
}) => {
  const details = {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    actorUserId: req.user?._id,
    actorRole: req.user?.isAdmin ? 'admin' : 'user',
  };

  if (targetUserId || document?.user || profile?.user) {
    details.targetUserId = targetUserId || document?.user || profile?.user;
  }

  if (profile?._id || document?.profile) {
    details.profileId = profile?._id || document?.profile;
  }

  if (document?._id) {
    details.qualificationDocumentId = document._id;
  }

  if (replacedDocumentId) {
    details.replacedDocumentId = replacedDocumentId;
  }

  if (document?.mimeType) {
    details.mimeType = document.mimeType;
  }

  if (document?.fileSizeBytes) {
    details.fileSizeBytes = document.fileSizeBytes;
  }

  if (document?.status) {
    details.documentStatus = document.status;
  }

  if (profileStatus) {
    details.profileStatus = profileStatus;
  }

  if (rejectionReasonProvided !== null) {
    details.rejectionReasonProvided = rejectionReasonProvided;
  }

  return details;
};

const logQualificationDocumentEvent = (event, options) => {
  logSecurityEvent(
    event,
    options.req.user?._id,
    buildQualificationDocumentAuditDetails(options),
  );
};

const getCloudinaryResourceType = (mimeType) =>
  mimeType === 'application/pdf' ? 'raw' : 'image';

const getQualificationDocumentDownloadFormat = (document) => {
  switch (document?.mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return null;
  }
};

const getQualificationDocumentDownloadResourceTypes = (document) => {
  if (document?.mimeType === 'application/pdf') {
    return ['image', 'raw'];
  }

  const resourceType =
    document?.cloudinaryResourceType ||
    getCloudinaryResourceType(document?.mimeType);

  return resourceType ? [resourceType] : [];
};

const buildQualificationDocumentSignedDownloadUrl = (
  document,
  resourceTypeOverride = null,
) => {
  if (!document?.cloudinaryPublicId) {
    return null;
  }

  const resourceType =
    resourceTypeOverride ||
    document.cloudinaryResourceType ||
    getCloudinaryResourceType(document.mimeType);
  const format = getQualificationDocumentDownloadFormat(document);

  if (!resourceType || !format) {
    return null;
  }

  return cloudinary.utils.private_download_url(
    document.cloudinaryPublicId,
    format,
    {
      resource_type: resourceType,
      type: 'upload',
      attachment: true,
    },
  );
};

const sanitizeDownloadFilename = (filename) =>
  (filename || 'qualification-document')
    .replace(/[\r\n"]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();

const ensureValidDocumentId = (id, res) => {
  if (!validateObjectId(id)) {
    res.status(400);
    throw new Error('Invalid qualification document ID format');
  }
};

const ensureProfileForUser = async (userId, res) => {
  const profile = await Profile.findOne({
    user: userId,
    lifecycleStatus: { $ne: 'deleting' },
  });

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  return profile;
};

const ensureQualificationFile = (file, res) => {
  if (!file) {
    res.status(400);
    throw new Error('No qualification document file provided');
  }

  if (!ALLOWED_QUALIFICATION_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
    res.status(400);
    throw new Error('Only PDF, JPG, and PNG qualification documents are allowed');
  }

  if (!file.size || file.size > MAX_QUALIFICATION_DOCUMENT_SIZE_BYTES) {
    res.status(400);
    throw new Error('Qualification document must be 5MB or less');
  }
};

const uploadQualificationAsset = async (file) => {
  const resourceType = getCloudinaryResourceType(file.mimetype);
  const uploadOptions = {
    folder: QUALIFICATION_DOCUMENT_FOLDER,
    resource_type: resourceType,
  };

  if (file.path) {
    const result = await cloudinary.uploader.upload(file.path, uploadOptions);
    return { result, resourceType };
  }

  if (file.buffer) {
    const result = await new Promise((resolve, reject) => {
      let isSettled = false;
      const settleOnce = (callback) => (value) => {
        if (isSettled) {
          return;
        }

        isSettled = true;
        clearTimeout(timeoutId);
        callback(value);
      };

      const resolveOnce = settleOnce(resolve);
      const rejectOnce = settleOnce(reject);

      const timeoutId = global.setTimeout(() => {
        rejectOnce(
          new Error(
            'Qualification document upload timed out while transferring to Cloudinary',
          ),
        );
      }, QUALIFICATION_DOCUMENT_UPLOAD_TIMEOUT_MS);

      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, uploadResult) => {
          if (error) {
            rejectOnce(error);
            return;
          }

          resolveOnce(uploadResult);
        },
      );

      uploadStream.on('error', rejectOnce);
      Readable.from(file.buffer).on('error', rejectOnce).pipe(uploadStream);
    });

    return { result, resourceType };
  }

  throw new Error('Uploaded file has no valid source');
};

const destroyQualificationAsset = async (document) => {
  if (!document?.cloudinaryPublicId) {
    return;
  }

  const failures = [];
  const resourceTypes = getQualificationDocumentDownloadResourceTypes(document);

  for (const resourceType of resourceTypes) {
    try {
      const result = await cloudinary.uploader.destroy(
        document.cloudinaryPublicId,
        {
          resource_type: resourceType,
        },
      );

      if (result?.result === 'ok') {
        return;
      }

      failures.push({
        resourceType,
        result: result?.result || 'unknown',
      });
    } catch (error) {
      failures.push({
        resourceType,
        error: error?.message || 'Unknown Cloudinary delete failure',
      });
    }
  }

  if (failures.length > 0) {
    logError(
      'Failed to delete qualification asset from Cloudinary',
      new Error('Cloudinary deletion failed for all resource types'),
      {
        documentId: document._id,
        cloudinaryPublicId: document.cloudinaryPublicId,
        failures,
      },
    );
  }
};

const cleanupTemporaryUploadFile = async (file) => {
  if (!file?.path) {
    return;
  }

  try {
    await unlink(file.path);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`Failed to delete temporary upload file: ${file.path}`, error);
    }
  }
};

const supersedeActiveDocuments = async (
  profileId,
  supersededAt,
  session = undefined,
) => {
  await QualificationDocument.updateMany(
    {
      profile: profileId,
      isActive: true,
    },
    {
      $set: {
        isActive: false,
        supersededAt,
      },
    },
    session ? { session } : undefined,
  );
};

const createQualificationSubmission = async ({
  profile,
  userId,
  file,
  res,
  replacementDocumentId = null,
}) => {
  ensureQualificationFile(file, res);

  const now = new Date();
  const { result, resourceType } = await uploadQualificationAsset(file);
  const session = await mongoose.startSession();
  let createdDocument;
  let replacementDocument = null;

  try {
    await session.withTransaction(async () => {
      const activeProfile = await Profile.findOne({
        _id: profile._id,
        user: userId,
        lifecycleStatus: { $ne: 'deleting' },
      }).session(session);

      if (!activeProfile) {
        res.status(409);
        throw new Error('Profile is unavailable for qualification uploads');
      }

      if (replacementDocumentId) {
        replacementDocument = await QualificationDocument.findOne({
          _id: replacementDocumentId,
          user: userId,
          profile: activeProfile._id,
        }).session(session);

        if (!replacementDocument) {
          res.status(404);
          throw new Error('Qualification document not found');
        }

        if (!replacementDocument.isActive) {
          res.status(400);
          throw new Error(
            'Only active qualification documents can be replaced',
          );
        }
      }

      await supersedeActiveDocuments(activeProfile._id, now, session);

      [createdDocument] = await QualificationDocument.create(
        [
          {
            user: userId,
            profile: activeProfile._id,
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            cloudinaryPublicId: result.public_id,
            cloudinaryResourceType: result.resource_type || resourceType,
            status: 'pending',
            rejectionReason: '',
            reviewedAt: null,
            reviewedBy: null,
            isActive: true,
            supersededAt: null,
          },
        ],
        { session },
      );

      await saveProfileQualificationSummary(
        activeProfile,
        QUALIFICATION_VERIFICATION_STATUSES.PENDING,
        now,
        { session },
      );
    });

    return {
      createdDocument,
      replacementDocument,
    };
  } catch (error) {
    await destroyQualificationAsset({
      cloudinaryPublicId: result.public_id,
      cloudinaryResourceType: result.resource_type || resourceType,
      mimeType: file.mimetype,
    }).catch(() => {});

    throw error;
  } finally {
    await session.endSession();
    await cleanupTemporaryUploadFile(file);
  }
};

// @description: List qualification documents for the authenticated user
// @route: GET /api/profile/qualification-documents
// @access: Private
const getQualificationDocuments = asyncHandler(async (req, res) => {
  const profile = await ensureProfileForUser(req.user._id, res);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id, profile: profile._id };
  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.isActive !== undefined) {
    filter.isActive = req.query.isActive;
  }

  const [documents, total] = await Promise.all([
    QualificationDocument.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    QualificationDocument.countDocuments(filter),
  ]);

  const activeDocument = documents.find((document) => document.isActive) ||
    (await QualificationDocument.findOne({
      user: req.user._id,
      profile: profile._id,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean());

  res.json({
    documents,
    page,
    pages: Math.ceil(total / limit),
    total,
    activeDocumentId: activeDocument?._id || null,
    profileStatus: profile.qualificationVerificationStatus || 'none',
  });
});

// @description: Upload a qualification document for the authenticated user
// @route: POST /api/profile/qualification-documents
// @access: Private
const uploadQualificationDocument = asyncHandler(async (req, res) => {
  const profile = await ensureProfileForUser(req.user._id, res);

  const { createdDocument } = await createQualificationSubmission({
    profile,
    userId: req.user._id,
    file: req.file,
    res,
  });

  logQualificationDocumentEvent(SecurityEvents.QUALIFICATION_DOCUMENT_UPLOADED, {
    req,
    profile,
    document: createdDocument,
    targetUserId: profile.user,
    profileStatus: QUALIFICATION_VERIFICATION_STATUSES.PENDING,
  });

  res.status(201).json({
    message: 'Qualification document uploaded successfully',
    document: createdDocument,
    profileStatus: QUALIFICATION_VERIFICATION_STATUSES.PENDING,
  });
});

// @description: Replace an active qualification document for the authenticated user
// @route: PUT /api/profile/qualification-documents/:id
// @access: Private
const replaceQualificationDocument = asyncHandler(async (req, res) => {
  ensureValidDocumentId(req.params.id, res);

  const profile = await ensureProfileForUser(req.user._id, res);

  const { createdDocument, replacementDocument } = await createQualificationSubmission({
    profile,
    userId: req.user._id,
    file: req.file,
    res,
    replacementDocumentId: req.params.id,
  });

  logQualificationDocumentEvent(SecurityEvents.QUALIFICATION_DOCUMENT_REPLACED, {
    req,
    profile,
    document: createdDocument,
    targetUserId: profile.user,
    replacedDocumentId: replacementDocument._id,
    profileStatus: QUALIFICATION_VERIFICATION_STATUSES.PENDING,
  });

  res.json({
    message: 'Qualification document replaced successfully',
    replacedDocumentId: replacementDocument._id,
    document: createdDocument,
    profileStatus: QUALIFICATION_VERIFICATION_STATUSES.PENDING,
  });
});

// @description: Delete a qualification document for the authenticated user
// @route: DELETE /api/profile/qualification-documents/:id
// @access: Private
const deleteQualificationDocument = asyncHandler(async (req, res) => {
  ensureValidDocumentId(req.params.id, res);

  const profile = await ensureProfileForUser(req.user._id, res);
  const document = await QualificationDocument.findOne({
    _id: req.params.id,
    user: req.user._id,
    profile: profile._id,
  });

  if (!document) {
    res.status(404);
    throw new Error('Qualification document not found');
  }

  await destroyQualificationAsset(document);
  const deletedWasActive = document.isActive === true;

  await document.deleteOne();

  if (deletedWasActive) {
    await syncProfileQualificationSummaryFromActiveDocument(profile, new Date());
  }

  logQualificationDocumentEvent(SecurityEvents.QUALIFICATION_DOCUMENT_DELETED, {
    req,
    profile,
    document,
    targetUserId: profile.user,
    profileStatus:
      profile.qualificationVerificationStatus ||
      QUALIFICATION_VERIFICATION_STATUSES.NONE,
  });

  res.json({
    message: 'Qualification document deleted successfully',
    deletedDocumentId: document._id,
    profileStatus: profile.qualificationVerificationStatus || 'none',
  });
});

// @description: List qualification documents for admin review
// @route: GET /api/profiles/admin/qualification-documents
// @access: Private/Admin
const getQualificationDocumentsAdmin = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.isActive !== undefined) {
    filter.isActive = req.query.isActive;
  }

  const [documents, total] = await Promise.all([
    QualificationDocument.find(filter)
      .populate('user', 'name email')
      .populate(
        'profile',
        'name email telephoneNumber profileImage qualificationVerificationStatus isQualificationsVerified qualificationStatusUpdatedAt',
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    QualificationDocument.countDocuments(filter),
  ]);

  res.json({
    documents,
    page,
    pages: Math.ceil(total / limit),
    total,
  });
});

// @description: Download a qualification document as an admin
// @route: GET /api/profiles/admin/qualification-documents/:id/download
// @access: Private/Admin
const downloadQualificationDocumentAdmin = asyncHandler(async (req, res) => {
  ensureValidDocumentId(req.params.id, res);

  const document = await QualificationDocument.findById(req.params.id).lean();

  if (!document) {
    res.status(404);
    throw new Error('Qualification document not found');
  }

  const deliveryCandidates = getQualificationDocumentDownloadResourceTypes(
    document,
  )
    .map((resourceType) => ({
      label: `${resourceType}-signed`,
      resourceType,
      url: buildQualificationDocumentSignedDownloadUrl(
        document,
        resourceType,
      ),
    }))
    .filter((candidate) => Boolean(candidate.url));

  if (deliveryCandidates.length === 0) {
    res.status(400);
    throw new Error('Qualification document download is unavailable');
  }

  let successfulResponse = null;
  const failures = [];

  for (const candidate of deliveryCandidates) {
    const response = await fetch(candidate.url);

    if (response.ok) {
      successfulResponse = response;
      break;
    }

    const responseBody = await response.text().catch(() => '');
    failures.push({
      candidate: candidate.label,
      status: response.status,
      statusText: response.statusText,
      responseBody,
    });
  }

  if (!successfulResponse) {
    const notFoundOnly =
      failures.length > 0 && failures.every((failure) => failure.status === 404);

    logError(
      'Failed to download qualification document from Cloudinary',
      new Error(
        notFoundOnly
          ? 'Qualification document not found in Cloudinary'
          : 'Cloudinary download failed for all candidate resource types',
      ),
      {
        documentId: document._id,
        cloudinaryPublicId: document.cloudinaryPublicId,
        failures,
      },
    );

    res.status(notFoundOnly ? 404 : 502);
    throw new Error(
      notFoundOnly
        ? 'Qualification document not found in Cloudinary'
        : 'Failed to download qualification document from Cloudinary',
    );
  }

  const contentType =
    successfulResponse.headers.get('content-type') ||
    document.mimeType ||
    'application/octet-stream';
  const contentLength = successfulResponse.headers.get('content-length');
  const downloadFilename = sanitizeDownloadFilename(document.originalFileName);
  const body = Buffer.from(await successfulResponse.arrayBuffer());

  res.setHeader('Content-Type', contentType);
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadFilename}"`,
  );

  logQualificationDocumentEvent(SecurityEvents.QUALIFICATION_DOCUMENT_DOWNLOADED, {
    req,
    document,
    targetUserId: document.user,
  });

  res.status(200).send(body);
});

// @description: Review a qualification document as an admin
// @route: PATCH /api/profiles/admin/qualification-documents/:id/review
// @access: Private/Admin
const reviewQualificationDocument = asyncHandler(async (req, res) => {
  ensureValidDocumentId(req.params.id, res);

  const document = await QualificationDocument.findById(req.params.id);

  if (!document) {
    res.status(404);
    throw new Error('Qualification document not found');
  }

  if (!document.isActive) {
    res.status(400);
    throw new Error('Only active qualification documents can be reviewed');
  }

  const profile = await Profile.findById(document.profile);

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  const reviewedAt = new Date();
  document.status = req.body.status;
  document.rejectionReason =
    req.body.status === 'rejected' ? req.body.rejectionReason : '';
  document.reviewedAt = reviewedAt;
  document.reviewedBy = req.user._id;

  const updatedDocument = await document.save();

  await saveProfileQualificationSummary(
    profile,
    updatedDocument.status,
    reviewedAt,
  );

  logQualificationDocumentEvent(
    updatedDocument.status === QUALIFICATION_VERIFICATION_STATUSES.APPROVED
      ? SecurityEvents.QUALIFICATION_DOCUMENT_APPROVED
      : SecurityEvents.QUALIFICATION_DOCUMENT_REJECTED,
    {
      req,
      profile,
      document: updatedDocument,
      targetUserId: updatedDocument.user,
      profileStatus: profile.qualificationVerificationStatus,
      rejectionReasonProvided:
        updatedDocument.status === QUALIFICATION_VERIFICATION_STATUSES.REJECTED
          ? Boolean(updatedDocument.rejectionReason)
          : null,
    },
  );

  res.json({
    message: `Qualification document ${updatedDocument.status} successfully`,
    document: updatedDocument,
    profileStatus: profile.qualificationVerificationStatus,
  });
});

export {
  getQualificationDocuments,
  uploadQualificationDocument,
  replaceQualificationDocument,
  deleteQualificationDocument,
  getQualificationDocumentsAdmin,
  downloadQualificationDocumentAdmin,
  reviewQualificationDocument,
};
