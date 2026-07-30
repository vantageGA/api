import mongoose from 'mongoose';

const loginEventSchema = mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  accountType: {
    type: String,
    enum: ['member'],
    default: 'member',
    required: true,
  },
  occurredAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
});

loginEventSchema.index({ accountType: 1, occurredAt: 1 });
loginEventSchema.index({ userId: 1, occurredAt: 1 });

export default mongoose.model('LoginEvent', loginEventSchema);
