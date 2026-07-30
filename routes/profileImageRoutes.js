import express from 'express';
import multer from 'multer';
import path from 'path';
import cloudinary from 'cloudinary';
import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import ProfileImages from '../models/profileImageModel.js';
import Profile from '../models/profileModel.js';
import { protect, requireActiveSubscription } from '../middleware/authMiddleware.js';
import { destroyCloudinaryAssets } from '../utils/cloudinaryAssetCleanup.js';

const router = express.Router();

const storage = multer.diskStorage({
  filename(req, file, cb) {
    cb(
      null,
      `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`,
    );
  },
});

function checkFileType(file, cb) {
  const filetypes = /jpg|jpeg|png/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb('Images only!');
  }
}

const upload = multer({
  storage,
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  },
});

// @description: Post PROFILE Images
// @route: POST /api/profileUpload
// @access: Private

router.post(
  '/',
  protect,
  requireActiveSubscription,
  upload.single('profileImage'),
  asyncHandler(async (req, res) => {
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
      folder: 'profileImage',
    });

    const session = await mongoose.startSession();
    let profileImage;

    try {
      await session.withTransaction(async () => {
        const profile = await Profile.findOne({
          user: req.user._id,
          lifecycleStatus: { $ne: 'deleting' },
        }).session(session);

        if (!profile) {
          res.status(409);
          throw new Error('Profile is unavailable for image uploads');
        }

        [profileImage] = await ProfileImages.create(
          [
            {
              user: req.user._id,
              name: req.user.name,
              avatar: result.secure_url,
              cloudinaryId: result.public_id,
            },
          ],
          { session },
        );

        profile.profileImage = result.secure_url;
        profile.cloudinaryId = result.public_id;
        await profile.save({ session });
      });
    } catch (error) {
      await destroyCloudinaryAssets(
        [{ publicId: result.public_id, resourceTypes: ['image'] }],
        {
          failureMessage:
            'Failed to clean up a profile image after database upload failure',
          context: { userId: req.user._id },
        },
      );
      throw error;
    } finally {
      await session.endSession();
    }

    res.status(200).json(profileImage);
  }),
);

export default router;
