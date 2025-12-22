import asyncHandler from 'express-async-handler';
import Profile from '../models/profileModel.js';
import ProfileImages from '../models/profileImageModel.js';
import UserReviewer from '../models/userReviewerModel.js';
import nodemailer from 'nodemailer';
import User from '../models/userModel.js';

// @description: Get All the Profiles
// @route: GET /api/profiles
// @access: Public
const getAllProfiles = asyncHandler(async (req, res) => {
  const profiles = await Profile.find({});
  if (profiles) {
    res.json(profiles);
  } else {
    res.status(404);
    throw new Error('No profiles found');
  }
});

// @description: Get All the users Profiles
// @route: GET /api/profiles
// @access: Admin
const getAllProfilesAdmin = asyncHandler(async (req, res) => {
  const profiles = await Profile.find({});
  if (profiles) {
    res.json(profiles);
  } else {
    res.status(404);
    throw new Error('No users found');
  }
});

// @description: Fetch single Profile
// @route: GET /api/profile/:id
// @access: Public
const getProfileById = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (profile) {
    res.json(profile);
  } else {
    res.status(404);
    throw new Error('Profile not found');
  }
});

// @description: Add profile after registration
// @route: POST /api/profiles
// @access: Private and Admin
const createProfile = asyncHandler(async (req, res) => {
  // Check if profile already exists for this user
  const existingProfile = await Profile.findOne({ user: req.user._id });

  if (existingProfile) {
    res.status(400);
    throw new Error('Profile already exists for this user');
  }

  // Create profile with user's email and name from their account
  const profile = new Profile({
    user: req.user._id,
    name: req.user.name || '',
    email: req.user.email || undefined, // Use undefined instead of empty string for sparse index
    faceBook: ``,
    instagram: ``,
    profileImage: 'uploads/profiles/sample.png',
    specialisation: '',
    location: '',
    qualifications: '',
    isQualificationsVerified: false,
    telephoneNumber: '',
    keyWordSearch: '',
    keyWordSearchOne: '',
    keyWordSearchTwo: '',
    keyWordSearchThree: '',
    keyWordSearchFour: '',
    keyWordSearchFive: '',
    specialisationOne: '',
    specialisationTwo: '',
    specialisationThree: '',
    specialisationFour: '',
    rating: 0,
    showName: false,
    description: '',
    numReviews: 0,
  });

  const createdProfile = await profile.save();
  res.status(201).json(createdProfile);
});

// @description: User Profile
// @route: GET /api/profile
// @access: PRIVATE
const getProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ user: req.user._id.toString() });

  if (!profile) {
    res.status(404);
    throw new Error('Profile not found');
  }

  res.json(profile);
});

// @description: Update Profile CLICKS
// @route: PUT /api/profile-clicks
// @access: PUBLIC
const updateProfileClicks = asyncHandler(async (req, res) => {
  const { _id, profileClickCounter } = req.body;

  const profile = await Profile.findById(_id);

  if (!profile) {
    res.status(404);
    throw new Error('User Not found');
  }

  profile.profileClickCounter =
    (profile.profileClickCounter || 0) + (profileClickCounter || 0);
  const updatedProfile = await profile.save();
  res.json(updatedProfile);
});

// @description: Update Profile
// @route: PUT /api/profile
// @access: PRIVATE
const updateProfile = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    faceBook,
    instagram,
    websiteUrl,
    profileImage,
    description,
    qualifications,
    specialisation,
    location,
    telephoneNumber,
    keyWordSearch,
    keyWordSearchOne,
    keyWordSearchTwo,
    keyWordSearchThree,
    keyWordSearchFour,
    keyWordSearchFive,
    specialisationOne,
    specialisationTwo,
    specialisationThree,
    specialisationFour,
  } = req.body;

  const profile = await Profile.findOne({ user: req.params.id });

  if (!profile) {
    res.status(404);
    throw new Error('No user found');
  }

  profile.user = req.params.id;
  profile.name = name;
  profile.email = email;
  profile.faceBook = faceBook;
  profile.instagram = instagram;
  profile.websiteUrl = websiteUrl;
  profile.profileImage = profileImage;
  profile.description = description;
  profile.qualifications = qualifications;
  profile.specialisation = specialisation;
  profile.location = location;
  profile.telephoneNumber = telephoneNumber;
  profile.keyWordSearch = keyWordSearch;
  profile.keyWordSearchOne = keyWordSearchOne;
  profile.keyWordSearchTwo = keyWordSearchTwo;
  profile.keyWordSearchThree = keyWordSearchThree;
  profile.keyWordSearchFour = keyWordSearchFour;
  profile.keyWordSearchFive = keyWordSearchFive;
  profile.specialisationOne = specialisationOne;
  profile.specialisationTwo = specialisationTwo;
  profile.specialisationThree = specialisationThree;
  profile.specialisationFour = specialisationFour;

  const updatedProfile = await profile.save();
  res.json(updatedProfile);
});

// @description: Delete a single user
// @route: DELETE /api/profiles/admin/:id
// @access: PRIVATE/Admin
const deleteProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (profile) {
    await profile.remove();
    res.json({ message: 'Profile successfully removed' });
  } else {
    res.status(404);
    throw new Error('Profile Not Found');
  }
});

// @description: Delete a single review
// @route: DELETE /api/profile/review/admin/:id
// @access: PRIVATE/Admin
const deleteReview = asyncHandler(async (req, res) => {
  const profileReview = await Profile.findOneAndUpdate(
    { _id: req.params.id },
    { $pull: { reviews: { _id: req.body.reviewId } } },
  );

  // We need you update the number of reviews and rating
  const profile = await Profile.findById(req.params.id);
  profile.numReviews = profile.reviews.length;
  profile.rating =
    profile.reviews.length > 0
      ? profile.reviews.reduce((acc, item) => item.rating + acc, 0) /
        profile.reviews.length
      : 0;
  await profile.save();
  // We need you update the number of reviews and rating

  res.json({ message: 'Review successfully removed' });
});

// @description: CREATE a new review
// @route: POST /api/profiles/:id/reviews
// @access: Private
const createProfileReview = asyncHandler(async (req, res) => {
  const { rating, comment, showName, userProfileId, acceptConditions } =
    req.body;

  const reviewerProfile = await UserReviewer.findById(req.params.id);
  const profile = await Profile.find({ user: userProfileId });

  //Find the user that was reviewed
  const user = await User.findById(userProfileId);

  // check if review exists
  const arrayOfId = profile[0].reviews.map((review) => review.user.toString());
  const allReadyReviewed = arrayOfId.includes(req.params.id);

  if (reviewerProfile && !allReadyReviewed && user) {
    const review = {
      user: req.params.id,
      name: reviewerProfile.name,
      showName,
      rating: Number(rating),
      comment,
      userProfileId: reviewerProfile.userProfileId,
      hasAccepted: acceptConditions,
    };

    profile[0].reviews.push(review);
    profile[0].numReviews = profile[0].reviews.length;
    profile[0].rating =
      profile[0].reviews.reduce((acc, item) => item.rating + acc, 0) /
      profile[0].reviews.length;

    await profile[0].save();

    // Send email to user telling thm that a review has been created
    let transporter = nodemailer.createTransport({
      host: process.env.MAILER_HOST,
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.MAILER_USER,
        pass: process.env.MAILER_PW,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    // send mail with defined transport object
    let info = await transporter.sendMail({
      from: '"Body Vantage" <info@bodyvantage.co.uk>', // sender address
      to: `${user.email}`, // list of receivers
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage REVIEW', // Subject line
      text: 'Body Vantage REVIEW', // plain text body
      html: `
      <h1>Hi ${user.name}</h1>
      <p>${review.name}, has submitted the following review about your service:</p>
      <p>"${review.comment}"</p>
      <p>This review has been published and will show on your profile page.</p>
      <h3>If you feel that this review is un-related or fake please contact BodyVantage management ASAP!</h3>

      <p>Thank you. Body Vantage management</p>
          
       
      `, // html body
    });

    console.log('Message sent: %s', info.messageId);
    // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

    // Preview only available when sending through an Ethereal account
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...

    // Send email to user telling thm that a review has been created

    res.status(201).json({ message: 'Review added successfully' });
  } else {
    res.status(404);
    throw new Error(
      'Profile not found or this profile has already been reviewed by you.',
    );
  }
});

// @description: Update Qualification to true/false
// @route: PUT /api/profiles/:id/verified
// @access: Private/Admin
const updateProfileQualificationToTrue = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);

  if (profile) {
    profile.isQualificationsVerified = true;
    const updateProfile = await profile.save();
    res.json(updateProfile);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @description: Get profile images
// @route: GET /api/profile-images
// @access: Private
const getAllProfileImages = asyncHandler(async (req, res) => {
  const profileImages = await ProfileImages.find({
    user: req.user._id.toString(),
  }).sort({ _id: -1 });

  if (profileImages) {
    res.json(profileImages);
  } else {
    res.status(404);
    throw new Error('No profile images found');
  }
});

// @description: Get profile images Public
// @route: GET /api/profile-images-public/:id
// @access: Public
const getAllProfileImagesPublic = asyncHandler(async (req, res) => {
  const profileImages = await ProfileImages.find({
    user: req.params.id,
  }).sort({ _id: -1 });

  if (profileImages) {
    res.json(profileImages);
  } else {
    res.status(404);
    throw new Error('No profile images found');
  }
});

export {
  getAllProfiles,
  getAllProfilesAdmin,
  getProfileById,
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  createProfileReview,
  updateProfileQualificationToTrue,
  deleteReview,
  updateProfileClicks,
  getAllProfileImages,
  getAllProfileImagesPublic,
};
