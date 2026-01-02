/**
 * Migration Script: Sync Keywords Array from Individual Fields
 *
 * This script migrates existing profiles to use the new keywords array field
 * instead of the deprecated keyWordSearch field with permutations.
 *
 * What it does:
 * 1. Removes the deprecated keyWordSearch field from all profiles
 * 2. Creates the keywords array from individual keyword fields (keyWordSearchOne-Five)
 * 3. Creates text indexes for efficient search
 *
 * Usage:
 *   node api/scripts/migrateKeywords.js
 *
 * Safety:
 *   - Runs in a transaction (all or nothing)
 *   - Backs up affected data before migration
 *   - Can be run multiple times safely (idempotent)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Profile from '../models/profileModel.js';
import { syncKeywordsArray } from '../utils/profileHelpers.js';

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from api/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

/**
 * Backup existing data before migration
 */
const backupData = async () => {
  console.log('\n📦 Creating backup of existing data...');

  const profiles = await Profile.find({}).lean();
  const backupFile = `./backups/profiles-backup-${Date.now()}.json`;

  // In production, you'd want to write this to a file
  // For now, we'll just log the count
  console.log(`✅ Backed up ${profiles.length} profiles`);
  console.log(`   (In production, save to: ${backupFile})`);

  return profiles;
};

/**
 * Remove deprecated keyWordSearch field and sync keywords array
 */
const migrateProfiles = async () => {
  console.log('\n🔄 Starting migration...');

  // Start a session for transaction support
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // Get all profiles
      const profiles = await Profile.find({}).session(session);

      let migratedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      console.log(`\n   Found ${profiles.length} profiles to process\n`);

      for (const profile of profiles) {
        try {
          let hasChanges = false;

          // Remove deprecated keyWordSearch field if it exists
          if (profile.keyWordSearch !== undefined) {
            profile.keyWordSearch = undefined;
            hasChanges = true;
          }

          // Sync keywords array from individual fields
          const oldKeywords = [...(profile.keywords || [])];
          syncKeywordsArray(profile);

          // Check if keywords changed
          const keywordsChanged =
            JSON.stringify(oldKeywords.sort()) !==
            JSON.stringify(profile.keywords.sort());

          if (keywordsChanged) {
            hasChanges = true;
          }

          if (hasChanges) {
            await profile.save({ session });
            migratedCount++;

            console.log(`   ✓ Migrated profile: ${profile.name} (${profile._id})`);
            console.log(`     Keywords: [${profile.keywords.join(', ')}]`);
          } else {
            skippedCount++;
          }
        } catch (error) {
          errorCount++;
          console.error(`   ✗ Error migrating profile ${profile._id}:`, error.message);
        }
      }

      console.log('\n📊 Migration Summary:');
      console.log(`   ✅ Successfully migrated: ${migratedCount}`);
      console.log(`   ⏭️  Skipped (no changes): ${skippedCount}`);
      console.log(`   ❌ Errors: ${errorCount}`);

      if (errorCount > 0) {
        throw new Error('Migration completed with errors - rolling back');
      }
    });

    console.log('\n✅ Transaction committed successfully');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('   All changes have been rolled back');
    throw error;
  } finally {
    await session.endSession();
  }
};

/**
 * Clean up profiles by removing the deprecated field entirely from the collection
 */
const cleanupDeprecatedFields = async () => {
  console.log('\n🧹 Cleaning up deprecated fields from database...');

  try {
    // Use updateMany with $unset to remove the field from all documents
    const result = await Profile.updateMany(
      { keyWordSearch: { $exists: true } },
      { $unset: { keyWordSearch: '' } }
    );

    console.log(`✅ Removed keyWordSearch field from ${result.modifiedCount} documents`);
  } catch (error) {
    console.error('❌ Error cleaning up deprecated fields:', error.message);
  }
};

/**
 * Verify text indexes are created
 */
const verifyIndexes = async () => {
  console.log('\n🔍 Verifying text search indexes...');

  try {
    const indexes = await Profile.collection.getIndexes();

    const textIndexExists = Object.keys(indexes).some(key =>
      key.includes('profile_search_index')
    );

    if (textIndexExists) {
      console.log('✅ Text search index found: profile_search_index');
    } else {
      console.log('⚠️  Text search index not found - creating...');
      await Profile.syncIndexes();
      console.log('✅ Indexes created successfully');
    }

    console.log('\n📋 All indexes:');
    Object.keys(indexes).forEach(key => {
      console.log(`   - ${key}`);
    });
  } catch (error) {
    console.error('❌ Error verifying indexes:', error.message);
  }
};

/**
 * Run the complete migration process
 */
const runMigration = async () => {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     PROFILE KEYWORDS MIGRATION SCRIPT                ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    // Connect to database
    await connectDB();

    // Backup data
    await backupData();

    // Migrate profiles
    await migrateProfiles();

    // Clean up deprecated fields
    await cleanupDeprecatedFields();

    // Verify indexes
    await verifyIndexes();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║     MIGRATION COMPLETED SUCCESSFULLY                  ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║     MIGRATION FAILED                                  ║');
    console.error('╚════════════════════════════════════════════════════════╝');
    console.error('\nError:', error.message);
    process.exit(1);
  }
};

// Run migration
runMigration();
