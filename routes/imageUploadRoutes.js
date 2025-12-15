import express from 'express';
import multer from 'multer';
import path from 'path';
import cloudinary from 'cloudinary';
import UserProfileImages from '../models/imageUploadModal.js';
import User from '../models/userModel.js';
import { protect } from '../middleware/authMiddleware.js';
import {
  deleteProfileImage,
  userProfileImageUpload,
} from '../controllers/imageUploadController.js';

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

// @description: Post USER Profile Images
// @route: POST /api/profileUpload
// @access: Private

router.post(
  '/',
  protect,
  upload.single('userProfileImage'),
  userProfileImageUpload,
);

//Delete a single PROFILE image
router.route('/profile-image/:id').delete(protect, deleteProfileImage);

export default router;
