import mongoose from 'mongoose';

const searchEventSchema = mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, maxlength: 100 },
    occurredAt: { type: Date, default: Date.now, index: true },
    keywordTokens: [{ type: String, trim: true, maxlength: 60 }],
    professionKey: { type: String, trim: true, maxlength: 200, default: '' },
    locationKey: { type: String, trim: true, maxlength: 200, default: '' },
    resultsCount: { type: Number, min: 0, default: 0 },
    criteriaCount: { type: Number, min: 1, max: 3, required: true },
    receiptNonce: {
      type: String,
      required: true,
      maxlength: 100,
      unique: true,
      sparse: true,
    },
    sessionHash: { type: String, required: true, maxlength: 64 },
    source: {
      type: String,
      enum: ['homepage', 'directory'],
      default: 'homepage',
    },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

searchEventSchema.index({ occurredAt: 1, professionKey: 1 });
searchEventSchema.index({ occurredAt: 1, locationKey: 1 });

export default mongoose.model('SearchEvent', searchEventSchema);
