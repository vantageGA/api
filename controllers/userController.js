import asyncHandler from 'express-async-handler';
import generateToken from '../utils/generateToken.js';
import User from '../models/userModel.js';
import Profile from '../models/profileModel.js';
import ProfileImages from '../models/profileImageModel.js';
import UserProfileImages from '../models/imageUploadModal.js';
import cloudinary from 'cloudinary';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';

// @description: Get All the users Profiles
// @route: GET /api/users
// @access: Admin
const getAllUsersProfile = asyncHandler(async (req, res) => {
  const users = await User.find({});
  if (users) {
    res.json(users);
  } else {
    res.status(404);
    throw new Error('No users found');
  }
});

// @description: Authenticate a user and get a token
// @route: POST /api/users/login
// @access: Public
const authUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email });

  if (user && (await user.matchPassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    });
  } else {
    res.status(401);
    throw new Error('Invalid user name or password');
  }
});

// @description: Register new user
// @route: POST /api/users
// @access: Public
const registerUser = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const userExists = await User.findOne({ email: email });

  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }
  const user = await User.create({
    name: name,
    email: email,
    password: password,
  });

  if (user) {
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      isConfirmed: user.isConfirmed,
      token: generateToken(user._id),
    });
    // create reusable transporter object using the default SMTP transport
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

    const link = `${process.env.MAILER_LOCAL_URL.replace(/\/$/, '')}/api/verify?token=${generateToken(user._id)}`;

    // send mail with defined transport object
    let info = await transporter.sendMail({
      from: '"Body Vantage" <info@bodyvantage.co.uk>', // sender address
      to: `${user.email}`, // list of receivers
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage Registration', // Subject line
      text: 'Body Vantage Registration', // plain text body
      html: `
      <h1>Hi ${user.name}</h1>
      <p>You have successfully registered with Body Vantage</p>
      <p>Please Click on the link to verify your email.</p>
      <br>
      <h4>Please note, in order to get full functionality you must confirm your mail address with the link below.</h4>
      <p><a href=${link} id='link'>Click here to verify</a></p>
      <p>Thank you. Body Vantage management</p>
          
       
      `, // html body
    });

    console.log('Message sent: %s', info.messageId);
    // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

    // Preview only available when sending through an Ethereal account
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

// @description: User Profile
// @route: GET /api/users/profile
// @access: PRIVATE
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      isConfirmed: user.isConfirmed,
      profileImage: user.profileImage,
      cloudinaryId: user.cloudinaryId,
    });
  } else {
    res.status(404);
    throw new Error('No user found');
  }
});

// @description: UPdate User Profile
// @route: PUT /api/users/profile
// @access: PRIVATE
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;

    if (req.body.password) {
      user.password = req.body.password;
    }
    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      isAdmin: updatedUser.isAdmin,
      token: generateToken(updatedUser._id),
    });
  } else {
    res.status(404);
    throw new Error('No user found');
  }
});

// @description: Fetch single Profile
// @route: GET /api/user/profile/:id
// @access: Public
const getUserProfileById = asyncHandler(async (req, res) => {
  const userProfile = await User.findById(req.params.id);
  if (userProfile) {
    res.json(userProfile);
  } else {
    res.status(404);
    throw new Error('Profile not found');
  }
});

// @description: Delete a single user with all related data
// @route: DELETE /api/users/:id
// @access: PRIVATE/Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('User Not Found');
  }

  // Configure Cloudinary
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_SECRET,
  });

  try {
    // 1. Delete all ProfileImages (profile page images) and their Cloudinary files
    const profileImages = await ProfileImages.find({ user: req.params.id });
    for (const image of profileImages) {
      if (image.cloudinaryId) {
        await cloudinary.uploader.destroy(image.cloudinaryId);
      }
      await image.remove();
    }

    // 2. Delete all UserProfileImages (user account images) and their Cloudinary files
    const userProfileImages = await UserProfileImages.find({ user: req.params.id });
    for (const image of userProfileImages) {
      if (image.cloudinaryId) {
        await cloudinary.uploader.destroy(image.cloudinaryId);
      }
      await image.remove();
    }

    // 3. Delete the user's Profile (this also deletes embedded reviews)
    const profile = await Profile.findOne({ user: req.params.id });
    if (profile) {
      // Delete profile's main image from Cloudinary if it exists
      if (profile.cloudinaryId) {
        await cloudinary.uploader.destroy(profile.cloudinaryId);
      }
      await profile.remove();
    }

    // 4. Delete the User
    await user.remove();

    res.json({
      message: 'User and all related data successfully removed',
      deleted: {
        profileImages: profileImages.length,
        userProfileImages: userProfileImages.length,
        profile: profile ? 1 : 0,
        user: 1
      }
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Error deleting user and related data: ${error.message}`);
  }
});

// @description: Update isAdmin to true/false
// @route: PUT /user/profile/:id
// @access: Private/Admin
const updateIsAdmin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    if (typeof req.body.val !== 'boolean') {
      res.status(400);
      throw new Error('isAdmin update requires a boolean value');
    }

    user.isAdmin = req.body.val;
    const updateIsAdmin = await user.save();
    res.json(updateIsAdmin);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

const userForgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email });

  if (user) {
    const token = generateToken(user._id, '15m');
    const link = `${process.env.RESET_PASSWORD_LOCAL_URL}/reset-password/${token}`;
    user.resetPasswordToken = token;
    await user.save();

    // create reusable transporter object using the default SMTP transport
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
      from: '"Body Vantage" <software@bodyvantage.co.uk>', // sender address
      to: `${user.email}`, // list of receivers
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage password re-set request', // Subject line
      text: 'Body Vantage password re-set request', // plain text body
      html: `
      <h1>Body Vantage password re-set request</h1>
      <p>You can re-set you password by clicking the link below</p>
      <a href=${link} id='link'>Click here to reset your password.</a>
      <h3 style="color: red;">PLEASE DELETE THIS EMAIL AFTER YOU HAVE RESET YOUR PASSWORD!!</h3>
      <p>Thank you. Body Vantage management</p>
          
       
      `, // html body
    });

    console.log('Message sent: %s', info.messageId);
    // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

    // Preview only available when sending through an Ethereal account
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...

    res.status(200).json('success');
  } else {
    res.status(409);
    throw new Error('Sorry, no match could be found for that email.');
  }
});

// @description: UPdate User PASSWORD
// @route: PUT /api/user-update-password
// @access: PUBLIC
const updateUserProfilePassword = asyncHandler(async (req, res) => {
  const { resetPasswordToken, password } = req.body;
  if (!resetPasswordToken || !password) {
    res.status(400);
    throw new Error('Missing reset token or password');
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(resetPasswordToken, process.env.JWT_SECRET);
  } catch (err) {
    res.status(401);
    throw new Error('Invalid or expired reset token');
  }

  const user = await User.findOne({
    _id: decodedToken.id,
    resetPasswordToken: resetPasswordToken,
  });
  if (!user) {
    res.status(404);
    throw new Error('No user found');
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  await user.save();
  res.status(201).json('Password Successfully updated.');
});

export {
  authUser,
  getUserProfile,
  registerUser,
  updateUserProfile,
  getAllUsersProfile,
  getUserProfileById,
  deleteUser,
  updateIsAdmin,
  userForgotPassword,
  updateUserProfilePassword,
};
