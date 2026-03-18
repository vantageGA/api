/**
 * Migration Script: Backfill Profile Qualification Verification Status
 *
 * Backfills legacy profile records that predate `qualificationVerificationStatus`.
 *
 * Mapping:
 * - isQualificationsVerified=true  -> qualificationVerificationStatus='approved'
 * - isQualificationsVerified=false -> qualificationVerificationStatus='none'
 *
 * Safety:
 * - Idempotent: only updates profiles with missing/invalid status values
 * - Transactional: all writes are committed together or rolled back
 *
 * Usage:
 *   node scripts/backfillQualificationVerificationStatus.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Profile from '../models/profileModel.js';

const VALID_STATUSES = ['none', 'pending', 'approved', 'rejected'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const getMongoUri = () => process.env.MONGO_URI || process.env.MONGODB_URI;

const connectDB = async () => {
  const mongoUri = getMongoUri();

  if (!mongoUri) {
    throw new Error('Missing MONGO_URI or MONGODB_URI in environment');
  }

  const conn = await mongoose.connect(mongoUri, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
  });

  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

const buildLegacyProfileFilter = () => ({
  $or: [
    { qualificationVerificationStatus: { $exists: false } },
    { qualificationVerificationStatus: null },
    { qualificationVerificationStatus: { $nin: VALID_STATUSES } },
  ],
});

const backfillProfiles = async () => {
  console.log('\nStarting qualification status backfill...');

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const legacyProfiles = await Profile.find(buildLegacyProfileFilter()).session(
        session,
      );

      console.log(`Found ${legacyProfiles.length} profiles requiring backfill`);

      let migratedCount = 0;

      for (const profile of legacyProfiles) {
        const targetStatus = profile.isQualificationsVerified ? 'approved' : 'none';
        const statusChanged = profile.qualificationVerificationStatus !== targetStatus;
        const timestampMissing = !profile.qualificationStatusUpdatedAt;

        profile.qualificationVerificationStatus = targetStatus;
        if (timestampMissing || statusChanged) {
          profile.qualificationStatusUpdatedAt = profile.updatedAt || new Date();
        }

        await profile.save({ session });
        migratedCount++;
      }

      console.log(`Backfilled ${migratedCount} profiles`);
    });

    console.log('Backfill committed successfully');
  } finally {
    await session.endSession();
  }
};

const run = async () => {
  console.log('==============================================');
  console.log(' Profile Qualification Status Backfill Script ');
  console.log('==============================================');

  try {
    await connectDB();
    await backfillProfiles();
    console.log('\nBackfill completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('\nBackfill failed:', error.message);
    process.exit(1);
  }
};

run();
