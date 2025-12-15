import asyncHandler from 'express-async-handler';
import nodemailer from 'nodemailer';

// @description: Send Email of details from contact form
// @route: POST /api/send
// @access: Public

const sendContactForm = asyncHandler(async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    res.status(400);
    throw new Error('Name, email, and message are required');
  }

  const transporter = nodemailer.createTransport({
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

  await transporter.sendMail({
    from: '"Body Vantage" <software@bodyvantage.co.uk>',
    to: `${email}`,
    subject: 'Body Vantage Contact Request',
    text: 'Body Vantage Contact Request',
    bcc: 'me@garyallin.uk',
    html: `
      <p>${message}</p> 
      <p>Thank you for contacting Body Vantage.</p>
      <p>We will be in touch shortly.</p>
      <p>Body Vantage management</p>  
      `,
  });

  res.status(201).json({
    message: 'Contact form sent successfully.',
  });
});

export { sendContactForm };
