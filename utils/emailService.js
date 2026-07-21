import nodemailer from 'nodemailer';
import validator from 'validator';

let transporter;

/**
 * Initialize the email transporter with secure configuration
 * Should be called once during application startup
 */
export const initEmailTransporter = () => {
  if (transporter) {
    return; // Already initialized
  }

  transporter = nodemailer.createTransport({
    host: process.env.MAILER_HOST,
    port: parseInt(process.env.MAILER_PORT) || 587,
    secure: process.env.MAILER_PORT === '465', // true for 465, false for other ports
    auth: {
      user: process.env.MAILER_USER,
      pass: process.env.MAILER_PW,
    },
    tls: {
      // Only disable in development for testing
      rejectUnauthorized: process.env.NODE_ENV === 'production',
      minVersion: 'TLSv1.2', // Enforce modern TLS
    },
  });

  console.log('Email transporter initialized');
};

/**
 * Sanitize text for use in HTML emails
 * Prevents HTML/JavaScript injection
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text safe for HTML
 */
const sanitizeForEmail = (text) => {
  if (!text) return '';
  return validator.escape(text.toString());
};

/**
 * Send review notification email to profile owner
 * @param {string} recipientEmail - Email address of the profile owner
 * @param {string} recipientName - Name of the profile owner
 * @param {string} reviewerName - Name of the reviewer
 * @param {string} reviewComment - The review comment text
 * @returns {Promise<Object>} Email send result
 * @throws {Error} If email validation fails or send fails
 */
export const sendReviewNotification = async (
  recipientEmail,
  recipientName,
  reviewerName,
  reviewComment
) => {
  if (!transporter) {
    throw new Error('Email transporter not initialized. Call initEmailTransporter() first.');
  }

  // Validate recipient email
  if (!validator.isEmail(recipientEmail)) {
    throw new Error('Invalid recipient email address');
  }

  // Sanitize all user-provided content
  const safeName = sanitizeForEmail(recipientName);
  const safeReviewerName = sanitizeForEmail(reviewerName);
  const safeComment = sanitizeForEmail(reviewComment);

  try {
    const info = await transporter.sendMail({
      from: process.env.MAILER_FROM || '"Body Vantage" <info@bodyvantage.co.uk>',
      to: recipientEmail,
      bcc: process.env.MAILER_BCC || 'info@bodyvantage.co.uk',
      subject: 'Body Vantage - New Review Notification',
      text: `Hi ${safeName},\n\n${safeReviewerName} has submitted the following review about your service:\n\n"${safeComment}"\n\nThis review has been published and will show on your profile page.\n\nIf you feel that this review is unrelated or fake, please contact BodyVantage management immediately.\n\nThank you,\nBody Vantage Management`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #333; margin-top: 0;">Hi ${safeName}</h1>
            <p style="color: #555; line-height: 1.6;">
              <strong>${safeReviewerName}</strong> has submitted the following review about your service:
            </p>
            <blockquote style="border-left: 4px solid #4CAF50; padding-left: 16px; margin: 20px 0; color: #555; font-style: italic; background-color: #f5f5f5; padding: 15px; border-radius: 4px;">
              "${safeComment}"
            </blockquote>
            <p style="color: #555; line-height: 1.6;">
              This review has been published and will show on your profile page.
            </p>
            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <p style="color: #856404; margin: 0; font-weight: bold;">
                If you feel that this review is unrelated or fake, please contact BodyVantage management immediately.
              </p>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #888; font-size: 14px; margin: 0;">
              Thank you,<br>
              <strong>Body Vantage Management</strong>
            </p>
          </div>
        </div>
      `,
    });

    console.log('Review notification email sent:', info.messageId);
    return info;
  } catch (error) {
    // Log the full error server-side
    console.error('Failed to send review notification email:', {
      error: error.message,
      stack: error.stack,
      recipient: recipientEmail,
    });

    // Throw a generic error to avoid exposing details
    throw new Error('Failed to send email notification');
  }
};

export const sendReviewModerationNotification = async (
  recipientEmail,
  recipientName,
  outcome,
  reason,
  actionUrl = '',
) => {
  if (!transporter) throw new Error('Email transporter not initialized');
  if (!validator.isEmail(recipientEmail)) throw new Error('Invalid recipient email address');

  const safeName = sanitizeForEmail(recipientName);
  const safeReason = sanitizeForEmail(reason);
  const safeActionUrl = actionUrl && validator.isURL(actionUrl, { require_protocol: true })
    ? sanitizeForEmail(actionUrl)
    : '';
  const amendmentRequested = outcome === 'amendment_requested';
  const subject = amendmentRequested
    ? 'Body Vantage - Review Amendment Requested'
    : 'Body Vantage - Review Moderation Decision';
  const decision = amendmentRequested
    ? 'An administrator has asked you to amend your review before it can be published.'
    : 'Your review was not approved for publication.';

  return transporter.sendMail({
    from: process.env.MAILER_FROM || '"Body Vantage" <info@bodyvantage.co.uk>',
    to: recipientEmail,
    bcc: process.env.MAILER_BCC || 'info@bodyvantage.co.uk',
    subject,
    text: `Hi ${safeName},\n\n${decision}\n\nReason: ${safeReason}${safeActionUrl ? `\n\nLog in to amend your review: ${safeActionUrl}` : ''}\n\nThank you,\nBody Vantage Management`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><h1 style="font-size:22px">Hi ${safeName}</h1><p>${decision}</p><p><strong>Reason:</strong> ${safeReason}</p>${safeActionUrl ? `<p><a href="${safeActionUrl}">Log in to amend your review</a></p>` : ''}<p>Thank you,<br><strong>Body Vantage Management</strong></p></div>`,
  });
};

/**
 * Get email transporter for other email operations
 * @returns {Object} Nodemailer transporter
 * @throws {Error} If transporter not initialized
 */
export const getTransporter = () => {
  if (!transporter) {
    throw new Error('Email transporter not initialized');
  }
  return transporter;
};
