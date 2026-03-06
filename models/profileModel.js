import mongoose from 'mongoose';

const reviewsSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      ref: 'UserReviewer',
    },
    name: {
      type: String,
      required: true,
    },
    rating: {
      type: Number,
      required: true,
    },
    comment: {
      type: String,
      required: true,
    },
    showName: {
      type: Boolean,
      required: true,
      default: false,
    },
    userProfileId: {
      type: String,
    },
    hasAccepted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// const clickCountSchema = mongoose.Schema(
//   {
//     user: {
//       type: mongoose.Schema.Types.ObjectId,
//       required: true,
//       ref: 'User',
//     },
//     clickCount: {
//       type: Number,
//     },
//   },
//   {
//     timestamps: true,
//   },
// );

const profileSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true, // Each user can only have one profile
      ref: 'User',
    },
    name: {
      type: String,
    },
    email: {
      type: String,
      required: false,
      unique: true,
      sparse: true, // Allows multiple null/undefined values, but enforces uniqueness for actual values
    },
    faceBook: {
      type: String,
    },
    instagram: {
      type: String,
    },
    websiteUrl: {
      type: String,
    },
    profileImage: {
      type: String,
    },
    cloudinaryId: {
      type: String,
    },
    description: {
      type: String,
    },
    specialisation: {
      type: String,
    },
    qualifications: {
      type: String,
    },
    isQualificationsVerified: {
      type: Boolean,
      required: true,
      default: false,
    },
    location: {
      type: String,
    },
    telephoneNumber: {
      type: String,
    },
    // Individual keywords for search - stored as array for better indexing
    keywords: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          return v.length <= 5;
        },
        message: 'Maximum 5 keywords allowed',
      },
    },
    // Legacy individual keyword fields - kept for backward compatibility during migration
    keyWordSearchOne: {
      type: String,
    },
    keyWordSearchTwo: {
      type: String,
    },
    keyWordSearchThree: {
      type: String,
    },
    keyWordSearchFour: {
      type: String,
    },
    keyWordSearchFive: {
      type: String,
    },
    specialisationOne: {
      type: String,
    },
    specialisationTwo: {
      type: String,
    },
    specialisationThree: {
      type: String,
    },
    specialisationFour: {
      type: String,
    },
    reviews: [reviewsSchema],
    profileClickCounter: { type: Number, default: 0 },
    rating: {
      type: Number,
      default: 0,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    onboardingTutorial: {
      required: {
        type: Boolean,
        default: true,
      },
      hasInteracted: {
        type: Boolean,
        default: false,
      },
      interactionType: {
        type: String,
        enum: ['play_started', 'progress', 'completed', 'manual_ack'],
      },
      watchProgressPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
      manualAcknowledged: {
        type: Boolean,
        default: false,
      },
      completionThresholdPercent: {
        type: Number,
        default: 90,
      },
      isCompleted: {
        type: Boolean,
        default: false,
      },
      firstInteractedAt: {
        type: Date,
        default: null,
      },
      completedAt: {
        type: Date,
        default: null,
      },
      version: {
        type: String,
        default: 'v1',
      },
    },
  },
  {
    timestamps: true,
  },
);

// Text indexes for efficient full-text search
// MongoDB will use these indexes for $text queries
profileSchema.index({
  name: 'text',
  description: 'text',
  location: 'text',
  specialisation: 'text',
  keywords: 'text',
}, {
  weights: {
    name: 10,
    keywords: 8,
    specialisation: 6,
    location: 4,
    description: 2,
  },
  name: 'profile_search_index',
});

// Individual field indexes for filtering
profileSchema.index({ location: 1 });
profileSchema.index({ specialisation: 1 });
profileSchema.index({ rating: -1, numReviews: -1 }); // Compound index for sorting
profileSchema.index({ keywords: 1 }); // Array index for keyword queries

const Profile = mongoose.model('Profile', profileSchema);

export default Profile;
