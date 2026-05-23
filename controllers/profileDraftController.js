import asyncHandler from 'express-async-handler';
import {
  createProfileDraft,
  getProfileDraftModel,
  isProfileDraftAIEnabled,
} from '../services/profileDraftAIService.js';
import {
  logError,
  logSecurityEvent,
  SecurityEvents,
} from '../utils/auditLogger.js';

const getProfileDraftFailureResponse = (error) => {
  const message = error?.message || '';
  const errorName = error?.name || '';

  if (
    errorName === 'InsufficientQuotaError' ||
    message.includes('exceeded your current quota')
  ) {
    return {
      statusCode: 503,
      message:
        'AI profile drafting quota is currently unavailable. Please check OpenAI billing and quota for this project.',
    };
  }

  if (
    errorName === 'RateLimitError' ||
    message.toLowerCase().includes('rate limit')
  ) {
    return {
      statusCode: 503,
      message:
        'AI profile drafting is temporarily rate limited. Please try again shortly.',
    };
  }

  if (error?.status === 401 || error?.status === 403) {
    return {
      statusCode: 503,
      message:
        'AI profile drafting credentials are unavailable. Please check the OpenAI API key for this project.',
    };
  }

  return {
    statusCode: 503,
    message: 'AI profile drafting is temporarily unavailable.',
  };
};

// @description: Generate an AI-assisted profile draft
// @route: POST /api/profile/ai-draft
// @access: PRIVATE
export const createProfileAIDraft = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  logSecurityEvent(SecurityEvents.PROFILE_AI_DRAFT_REQUESTED, userId, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    inputLength: req.body?.input?.length || 0,
    model: getProfileDraftModel(),
  });

  if (!isProfileDraftAIEnabled() || !process.env.OPENAI_API_KEY) {
    res.status(503);
    throw new Error('AI profile drafting is temporarily unavailable.');
  }

  try {
    const result = await createProfileDraft({
      input: req.body.input,
      currentProfile: req.body.currentProfile || {},
    });

    logSecurityEvent(SecurityEvents.PROFILE_AI_DRAFT_SUCCEEDED, userId, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      model: getProfileDraftModel(),
      returnedFields: Object.entries(result.draft)
        .filter(([, value]) =>
          Array.isArray(value) ? value.length > 0 : Boolean(value),
        )
        .map(([field]) => field),
      missingFieldCount: result.missingFields.length,
    });

    res.json(result);
  } catch (error) {
    logSecurityEvent(SecurityEvents.PROFILE_AI_DRAFT_FAILED, userId, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      model: getProfileDraftModel(),
      errorName: error.name,
    });

    logError('Profile AI draft generation failed', error, {
      userId,
      model: getProfileDraftModel(),
    });

    const { statusCode, message } = getProfileDraftFailureResponse(error);
    res.status(statusCode);
    throw new Error(message);
  }
});
