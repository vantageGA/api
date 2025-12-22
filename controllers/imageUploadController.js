import asyncHandler from 'express-async-handler';
import cloudinary from 'cloudinary';
import UserProfileImages from '../models/imageUploadModal.js';
import ProfileImages from '../models/profileImageModel.js';
import User from '../models/userModel.js';

// @description: Post USER Profile Images
// @route: POST /api/userProfileUpload
// @access: Private
const userProfileImageUpload = asyncHandler(async (req, res) => {
  if (!req.file?.path) {
    res.status(400);
    throw new Error('No image file provided');
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });

  const result = await cloudinary.uploader.upload(`${req.file.path}`, {
    folder: 'userProfileImage',
  });

  // Associate the profile image with the user
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const profileImage = new UserProfileImages({
    user: req.user._id,
    name: req.user.name,
    avatar: result.secure_url,
    cloudinaryId: result.public_id,
  });

  // Update the user
  user.profileImage = result.secure_url;
  user.cloudinaryId = result.public_id;
  await user.save();

  await profileImage.save();

  res.status(201).json({
    message: 'Profile image uploaded',
    user,
    profileImage,
  });
});

// @description: Delete a single PROFILE Image
// @route: DELETE /api/profile-image/:id
// @access: PRIVATE
const deleteProfileImage = asyncHandler(async (req, res) => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });

  const profile = await ProfileImages.findOne({
    _id: req.params.id,
    user: req.user._id.toString(),
  });

  if (!profile) {
    res.status(404);
    throw new Error('Profile image not found');
  }

  // Remove image from cloudinary
  if (profile.cloudinaryId) {
    await cloudinary.uploader.destroy(`${profile.cloudinaryId}`);
  }

  // Remove from profile Image model
  await profile.deleteOne();
  res.json({ message: 'Profile image successfully removed' });
});

export { userProfileImageUpload, deleteProfileImage };
