import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const userSchema = mongoose.Schema(
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
    },
    isAdmin: {
      type: Boolean,
      required: true,
      default: false,
    },
    isConfirmed: {
      type: Boolean,
      required: true,
      default: false,
    },
    profileImage: {
      type: String,
    },
    cloudinaryId: {
      type: String,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordTokenExpiry: {
      type: Date,
    },
    resetPasswordAttempts: {
      type: Number,
      default: 0,
    },
    resetPasswordLastAttempt: {
      type: Date,
    },
    pendingEmail: {
      type: String,
    },
    emailChangeToken: {
      type: String,
    },
    emailChangeTokenExpiry: {
      type: Date,
    },
    stripeCustomerId: {
      type: String,
    },
    stripeSubscriptionId: {
      type: String,
    },
    isSubscribed: {
      type: Boolean,
      default: false,
    },
    plan: {
      type: String, // 'monthly' or 'annual'
    },
    currentPeriodEnd: {
      type: Date,
    },
    paymentStatus: {
      type: String, // 'active', 'failed', 'canceled'
      default: 'active',
    },
  },
  {
    timestamps: true,
  },
);

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Create hashed password reset token
userSchema.methods.createPasswordResetToken = function (token) {
  // Hash the token before storing
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  this.resetPasswordToken = hashedToken;
  this.resetPasswordTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes
  return hashedToken;
};

// Verify password reset token
userSchema.methods.verifyPasswordResetToken = function (token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return this.resetPasswordToken === hashedToken &&
         this.resetPasswordTokenExpiry > Date.now();
};

// Clear password reset fields
userSchema.methods.clearPasswordResetToken = function () {
  this.resetPasswordToken = undefined;
  this.resetPasswordTokenExpiry = undefined;
  this.resetPasswordAttempts = 0;
};

// Adding the encryption before saving to DB
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);

export default User;
