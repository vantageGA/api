import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userReviewerSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    isConfirmed: {
      type: Boolean,
      required: true,
      default: false,
    },
    hasSubmittedReview: {
      type: Boolean,
      default: false,
    },
    deletionPending: {
      type: Boolean,
      default: false,
      select: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordTokenExpiry: {
      type: Date,
      select: false,
    },
    resetPasswordAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    resetPasswordLastAttempt: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  },
);

userReviewerSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Create hashed password reset token
userReviewerSchema.methods.createPasswordResetToken = function (token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  this.resetPasswordToken = hashedToken;
  this.resetPasswordTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes
  return hashedToken;
};

// Clear password reset fields
userReviewerSchema.methods.clearPasswordResetToken = function () {
  this.resetPasswordToken = undefined;
  this.resetPasswordTokenExpiry = undefined;
  this.resetPasswordAttempts = 0;
};
// Adding the encrypton before saving to DB
userReviewerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const UserReviewer = mongoose.model('UserReviewer', userReviewerSchema);

export default UserReviewer;
