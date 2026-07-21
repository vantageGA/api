import nodemailer from 'nodemailer';

// Create reusable transporter (singleton pattern)
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.MAILER_HOST,
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.MAILER_USER,
        pass: process.env.MAILER_PW,
      },
      tls: {
        rejectUnauthorized: true, // Validate certificates - SECURE
        minVersion: 'TLSv1.2' // Enforce minimum TLS version
      },
    });
  }
  return transporter;
};

// Escape HTML to prevent XSS in emails
const escapeHtml = (text) => {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
};

// Send email verification email
export const sendVerificationEmail = async (user, verificationToken) => {
  if (!user || !user.email || !verificationToken) {
    throw new Error('Invalid email parameters');
  }

  const baseUrl = process.env.NODE_ENV === 'production' 
    ? process.env.MAILER_PRODUCTION_URL || process.env.FRONTEND_URL 
    : process.env.MAILER_LOCAL_URL;
  const link = `${baseUrl.replace(/\/$/, '')}/verify-email?token=${verificationToken}`;
  const transport = getTransporter();

  try {
    const info = await transport.sendMail({
      from: '"Body Vantage" <info@bodyvantage.co.uk>',
      to: user.email,
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage Registration',
      text: `Hi ${user.name}, You have successfully registered with Body Vantage. Please click the link to verify your email: ${link}`,
      html: `
        <h1>Hi ${escapeHtml(user.name)}</h1>
        <p>You have successfully registered with Body Vantage</p>
        <p>Please click the link below to verify your email.</p>
        <br>
        <h4>Please note, in order to get full functionality you must confirm your mail address with the link below.</h4>
        <p><a href="${escapeHtml(link)}">Click here to verify</a></p>
        <p>Thank you, Body Vantage management</p>
      `,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('Verification email sent: %s', info.messageId);
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }

    return info;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw new Error('Failed to send verification email');
  }
};

// Send password reset email
export const sendPasswordResetEmail = async (user, resetToken) => {
  if (!user || !user.email || !resetToken) {
    throw new Error('Invalid email parameters');
  }

  const baseUrl = process.env.NODE_ENV === 'production' 
    ? process.env.RESET_PASSWORD_PRODUCTION_URL || process.env.FRONTEND_URL 
    : process.env.RESET_PASSWORD_LOCAL_URL;
  const link = `${baseUrl.replace(/\/$/, '')}/reset-password/${resetToken}`;
  const transport = getTransporter();

  try {
    const info = await transport.sendMail({
      from: '"Body Vantage" <software@bodyvantage.co.uk>',
      to: user.email,
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage password reset request',
      text: `Body Vantage password reset request. You can reset your password by clicking this link: ${link}. PLEASE DELETE THIS EMAIL AFTER YOU HAVE RESET YOUR PASSWORD!`,
      html: `
        <h1>Body Vantage password reset request</h1>
        <p>You can reset your password by clicking the link below</p>
        <p><a href="${escapeHtml(link)}">Click here to reset your password</a></p>
        <h3 style="color: red;">PLEASE DELETE THIS EMAIL AFTER YOU HAVE RESET YOUR PASSWORD!</h3>
        <p>If you did not request this password reset, please ignore this email.</p>
        <p>Thank you, Body Vantage management</p>
      `,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('Password reset email sent: %s', info.messageId);
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }

    return info;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
};

// Send password changed confirmation email
export const sendPasswordChangedEmail = async (user) => {
  if (!user || !user.email) {
    throw new Error('Invalid email parameters');
  }

  const transport = getTransporter();

  try {
    const info = await transport.sendMail({
      from: '"Body Vantage" <software@bodyvantage.co.uk>',
      to: user.email,
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage password changed',
      text: `Hi ${user.name}, Your password has been successfully changed. If you did not make this change, please contact us immediately.`,
      html: `
        <h1>Hi ${escapeHtml(user.name)}</h1>
        <p>Your password has been successfully changed.</p>
        <p>If you did not make this change, please contact us immediately at info@bodyvantage.co.uk</p>
        <p>Thank you, Body Vantage management</p>
      `,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('Password changed email sent: %s', info.messageId);
    }

    return info;
  } catch (error) {
    console.error('Failed to send password changed email:', error);
    // Don't throw error - password change succeeded, email is secondary
    return null;
  }
};

// Send email change verification email
export const sendEmailChangeVerification = async (newEmail, verificationToken, userName) => {
  if (!newEmail || !verificationToken || !userName) {
    throw new Error('Invalid email parameters');
  }

  const baseUrl = process.env.NODE_ENV === 'production' 
    ? process.env.MAILER_PRODUCTION_URL || process.env.FRONTEND_URL 
    : process.env.MAILER_LOCAL_URL;
  const link = `${baseUrl.replace(/\/$/, '')}/verify-email-change?token=${verificationToken}`;
  const transport = getTransporter();

  try {
    const info = await transport.sendMail({
      from: '"Body Vantage" <info@bodyvantage.co.uk>',
      to: newEmail,
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Body Vantage email change verification',
      text: `Hi ${userName}, Please verify your new email address by clicking this link: ${link}`,
      html: `
        <h1>Hi ${escapeHtml(userName)}</h1>
        <p>You have requested to change your email address for your Body Vantage account.</p>
        <p>Please click the link below to verify your new email address.</p>
        <p><a href="${escapeHtml(link)}">Click here to verify your new email</a></p>
        <p>If you did not request this change, please ignore this email.</p>
        <p>Thank you, Body Vantage management</p>
      `,
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log('Email change verification sent: %s', info.messageId);
    }

    return info;
  } catch (error) {
    console.error('Failed to send email change verification:', error);
    throw new Error('Failed to send email change verification');
  }
};

export const sendProfileReactivatedEmail = async (user) => {
  if (!user?.email) return null;

  try {
    return await getTransporter().sendMail({
      from: '"Body Vantage" <info@bodyvantage.co.uk>',
      to: user.email,
      bcc: 'info@bodyvantage.co.uk',
      subject: 'Your Body Vantage profile has been reactivated',
      text: `Hi ${user.name}, your Body Vantage profile has been reactivated and is visible in the public directory again.`,
      html: `<h1>Hi ${escapeHtml(user.name)}</h1><p>Your Body Vantage profile has been reactivated and is visible in the public directory again.</p><p>Thank you, Body Vantage management</p>`,
    });
  } catch (error) {
    console.error('Failed to send profile reactivation email:', error);
    return null;
  }
};
