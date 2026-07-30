import dotenv from 'dotenv';
import mongoose from 'mongoose';
import LoginEvent from '../models/loginEventModel.js';
import SearchEvent from '../models/searchEventModel.js';

dotenv.config({ quiet: true });

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGO_URI or MONGODB_URI is required.');
}

const hasIndex = (indexes, key, optionCheck = () => true) => indexes.some(
  (index) => (
    JSON.stringify(index.key) === JSON.stringify(key)
    && optionCheck(index)
  ),
);

try {
  await mongoose.connect(uri);
  const redactionResult = await SearchEvent.collection.updateMany(
    { normalizedQuery: { $exists: true } },
    { $unset: { normalizedQuery: '' } },
  );
  await Promise.all([
    LoginEvent.createIndexes(),
    SearchEvent.createIndexes(),
  ]);

  const retainedLastLogins = await LoginEvent.aggregate([
    { $group: { _id: '$userId', lastSuccessfulLoginAt: { $max: '$occurredAt' } } },
  ]);
  let backfillMatchedCount = 0;
  let backfillModifiedCount = 0;
  for (let offset = 0; offset < retainedLastLogins.length; offset += 500) {
    const batch = retainedLastLogins.slice(offset, offset + 500);
    const result = await mongoose.connection.collection('users').bulkWrite(
      batch.map((row) => ({
        updateOne: {
          filter: { _id: row._id, isAdmin: { $ne: true } },
          update: { $max: { lastSuccessfulLoginAt: row.lastSuccessfulLoginAt } },
        },
      })),
      { ordered: false },
    );
    backfillMatchedCount += result.matchedCount || 0;
    backfillModifiedCount += result.modifiedCount || 0;
  }
  console.log(`Legacy raw search queries removed: ${redactionResult.modifiedCount || 0}`);
  console.log(`Durable login backfill candidates: ${retainedLastLogins.length}`);
  console.log(`Durable login backfill users matched: ${backfillMatchedCount}`);
  console.log(`Durable login timestamps modified: ${backfillModifiedCount}`);

  const [loginIndexes, searchIndexes] = await Promise.all([
    LoginEvent.collection.indexes(),
    SearchEvent.collection.indexes(),
  ]);

  const checks = [
    ['LoginEvent TTL', loginIndexes, { expiresAt: 1 }, (index) => index.expireAfterSeconds === 0],
    ['LoginEvent member/time', loginIndexes, { userId: 1, occurredAt: 1 }],
    ['SearchEvent TTL', searchIndexes, { expiresAt: 1 }, (index) => index.expireAfterSeconds === 0],
    ['SearchEvent event dedupe', searchIndexes, { eventId: 1 }, (index) => index.unique === true],
    ['SearchEvent receipt dedupe', searchIndexes, { receiptNonce: 1 }, (index) => index.unique === true],
  ];
  const failed = checks.filter(([, indexes, key, check]) => (
    !hasIndex(indexes, key, check)
  ));

  checks.forEach(([label, indexes, key, check]) => {
    console.log(`${label}: ${hasIndex(indexes, key, check) ? 'ok' : 'missing'}`);
  });

  if (failed.length) {
    process.exitCode = 1;
  }
} finally {
  await mongoose.disconnect();
}
