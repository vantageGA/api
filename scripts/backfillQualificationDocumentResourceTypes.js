/**
 * Migration Script: Backfill Qualification Document Cloudinary Resource Types
 *
 * Backfills existing qualification document records with the actual Cloudinary
 * resource type for each stored asset.
 *
 * Safety:
 * - Idempotent: only updates documents whose stored type differs from Cloudinary
 * - Rerunnable: skips documents that already match or whose asset is missing
 * - Non-transactional: Cloudinary lookups are external and cannot be wrapped
 *   in a single MongoDB transaction safely
 *
 * Usage:
 *   node scripts/backfillQualificationDocumentResourceTypes.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cloudinary from 'cloudinary';
import path from 'path';
import { fileURLToPath } from 'url';
import QualificationDocument from '../models/qualificationDocumentModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const getMongoUri = () => process.env.MONGO_URI || process.env.MONGODB_URI;

const ensureRequiredEnv = () => {
  const requiredEnvVars = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_SECRET',
  ];

  const missing = requiredEnvVars.filter((name) => !process.env[name]);

  if (!getMongoUri()) {
    missing.push('MONGO_URI or MONGODB_URI');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

const connectDB = async () => {
  const mongoUri = getMongoUri();
  const conn = await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_SECRET.trim(),
  });
};

const uniquePreserveOrder = (values) => [...new Set(values.filter(Boolean))];

const buildResourceTypeCandidates = (document) => {
  if (document?.mimeType === 'application/pdf') {
    return uniquePreserveOrder([
      'image',
      document?.cloudinaryResourceType,
      'raw',
      'auto',
    ]);
  }

  return uniquePreserveOrder([
    document?.cloudinaryResourceType,
    document?.mimeType && document.mimeType.startsWith('image/') ? 'image' : null,
    'auto',
  ]);
};

const resolveCloudinaryResourceType = async (document) => {
  const candidates = buildResourceTypeCandidates(document);
  const errors = [];

  for (const resourceType of candidates) {
    try {
      const result = await cloudinary.api.resource(document.cloudinaryPublicId, {
        resource_type: resourceType,
        type: 'upload',
      });

      if (result?.public_id) {
        return {
          resourceType: result.resource_type,
        };
      }
    } catch (error) {
      errors.push({
        resourceType,
        status: error?.http_code,
        message: error?.message,
      });

      if (error?.http_code && error.http_code !== 404) {
        throw new Error(
          `Cloudinary lookup failed for ${document.cloudinaryPublicId} (${resourceType}): ${error.message}`,
        );
      }
    }
  }

  return {
    resourceType: null,
    errors,
  };
};

const backfillQualificationDocumentResourceTypes = async () => {
  console.log('\nStarting qualification document resource type backfill...');

  const documents = await QualificationDocument.find(
    { cloudinaryPublicId: { $exists: true, $nin: [null, ''] } },
    {
      originalFileName: 1,
      mimeType: 1,
      cloudinaryPublicId: 1,
      cloudinaryResourceType: 1,
      createdAt: 1,
    },
  )
    .sort({ createdAt: 1 })
    .lean();

  console.log(`Found ${documents.length} qualification documents to inspect`);

  let inspectedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let missingCount = 0;

  for (const document of documents) {
    inspectedCount++;

    const resolved = await resolveCloudinaryResourceType(document);

    if (!resolved.resourceType) {
      missingCount++;
      console.log(
        `   - Missing in Cloudinary: ${document._id} (${document.originalFileName})`,
      );
      continue;
    }

    if (document.cloudinaryResourceType === resolved.resourceType) {
      skippedCount++;
      console.log(
        `   = Already correct: ${document._id} (${document.originalFileName}) -> ${resolved.resourceType}`,
      );
      continue;
    }

    await QualificationDocument.updateOne(
      { _id: document._id },
      {
        $set: {
          cloudinaryResourceType: resolved.resourceType,
        },
      },
    );

    updatedCount++;
    console.log(
      `   ✓ Updated: ${document._id} (${document.originalFileName}) ${document.cloudinaryResourceType || 'missing'} -> ${resolved.resourceType}`,
    );
  }

  console.log('\nResource type backfill summary:');
  console.log(`   Inspected: ${inspectedCount}`);
  console.log(`   Updated:   ${updatedCount}`);
  console.log(`   Skipped:   ${skippedCount}`);
  console.log(`   Missing:   ${missingCount}`);
};

const run = async () => {
  console.log('==============================================================');
  console.log(' Qualification Document Resource Type Backfill Script ');
  console.log('==============================================================');

  try {
    ensureRequiredEnv();
    configureCloudinary();
    await connectDB();
    await backfillQualificationDocumentResourceTypes();
    console.log('\nBackfill completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\nBackfill failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

run();
