import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

const DEFAULT_PROFILE_DRAFT_MODEL = 'gpt-5.5';
const DEFAULT_WARNING =
  'Please verify all qualification and experience claims before saving.';

const FIELD_LIMITS = Object.freeze({
  location: 200,
  telephoneNumber: 20,
  websiteUrl: 500,
  faceBook: 500,
  instagram: 500,
  description: 2000,
  specialisation: 400,
  qualifications: 1000,
  specialisationOne: 100,
  specialisationTwo: 100,
  specialisationThree: 100,
  specialisationFour: 100,
});

const MISSING_FIELD_NAMES = Object.freeze([
  'location',
  'telephoneNumber',
  'websiteUrl',
  'faceBook',
  'instagram',
  'description',
  'specialisation',
  'qualifications',
  'keywords',
  'specialisationOne',
  'specialisationTwo',
  'specialisationThree',
  'specialisationFour',
]);

const nullableString = (label, maxCharacters) =>
  z
    .string()
    .max(maxCharacters)
    .nullable()
    .describe(`${label}; return null when not provided by the user.`);

export const profileDraftOutputSchema = z
  .object({
    location: nullableString('UK location or service area', FIELD_LIMITS.location),
    telephoneNumber: nullableString(
      'UK telephone number exactly as supplied',
      FIELD_LIMITS.telephoneNumber,
    ),
    websiteUrl: nullableString(
      'Professional website URL or domain exactly as supplied',
      FIELD_LIMITS.websiteUrl,
    ),
    faceBook: nullableString(
      'Facebook username or profile handle exactly as supplied',
      FIELD_LIMITS.faceBook,
    ),
    instagram: nullableString(
      'Instagram username or profile handle exactly as supplied',
      FIELD_LIMITS.instagram,
    ),
    description: nullableString(
      'Plain text professional public profile description in UK English',
      FIELD_LIMITS.description,
    ),
    specialisation: nullableString(
      'Plain text summary of professional specialisms in UK English',
      FIELD_LIMITS.specialisation,
    ),
    qualifications: nullableString(
      'Plain text qualifications and training stated by the user',
      FIELD_LIMITS.qualifications,
    ),
    specialisationOne: nullableString(
      'First concise specialisation keyword',
      FIELD_LIMITS.specialisationOne,
    ),
    specialisationTwo: nullableString(
      'Second concise specialisation keyword',
      FIELD_LIMITS.specialisationTwo,
    ),
    specialisationThree: nullableString(
      'Third concise specialisation keyword',
      FIELD_LIMITS.specialisationThree,
    ),
    specialisationFour: nullableString(
      'Fourth concise specialisation keyword',
      FIELD_LIMITS.specialisationFour,
    ),
    keywords: z
      .array(z.string().min(3).max(50))
      .max(5)
      .describe('Up to five concise public search keywords from the user text.'),
    missingFields: z
      .array(z.enum(MISSING_FIELD_NAMES))
      .max(MISSING_FIELD_NAMES.length)
      .describe('Important profile fields not found in the user text.'),
    warnings: z
      .array(z.string().min(3).max(180))
      .max(5)
      .describe('Short warnings the user should review before saving.'),
  })
  .strict()
  .describe('BodyVantage profile draft fields extracted from natural language.');

const SYSTEM_PROMPT = `You draft BodyVantage public professional profile fields from user-provided text.

Rules:
- Extract only information present in the user's text or current profile context.
- Do not invent qualifications, experience length, location, services, phone numbers, websites, or social handles.
- If a field is not present, return null for that field.
- Write description, specialisation, and qualifications in clear professional UK English.
- Format location with enough detail for the form, such as town/city plus county or UK when that is clear from the user's text.
- Return five search keywords and four specialisation keywords whenever the user's text contains enough relevant terms.
- Keep wording suitable for a public professional directory.
- Avoid exaggerated claims and medical or regulated claims unless the user clearly states them.
- Do not return HTML, Markdown, bullet syntax, or emojis.
- Never return admin, verification, subscription, document, image, review, rating, click counter, onboarding, user id, or email-confirmation fields.
- Include a warning whenever qualification, training, years of experience, or regulated-service claims should be checked by the user before saving.`;

const compactText = (value, maxCharacters) => {
  if (typeof value !== 'string') return null;

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  return normalized.slice(0, maxCharacters);
};

const normalizeUsername = (value, maxCharacters) => {
  const normalized = compactText(value, maxCharacters);
  if (!normalized) return null;

  return normalized.replace(/^@+/, '');
};

const normalizeKeyword = (value) => {
  const normalized = compactText(value, 50);
  if (!normalized || normalized.length < 3) return null;

  return normalized
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const uniqueList = (items) => [...new Set(items.filter(Boolean))];

const deriveMissingFields = (draft) => {
  const missing = [];

  for (const field of [
    'location',
    'telephoneNumber',
    'description',
    'specialisation',
    'qualifications',
    'specialisationOne',
    'specialisationTwo',
    'specialisationThree',
    'specialisationFour',
  ]) {
    if (!draft[field]) missing.push(field);
  }

  if (!draft.keywords?.length) {
    missing.push('keywords');
  }

  return missing;
};

export const normalizeProfileDraft = (rawDraft = {}) => {
  const draft = {
    location: compactText(rawDraft.location, FIELD_LIMITS.location),
    telephoneNumber: compactText(
      rawDraft.telephoneNumber,
      FIELD_LIMITS.telephoneNumber,
    ),
    websiteUrl: compactText(rawDraft.websiteUrl, FIELD_LIMITS.websiteUrl),
    faceBook: normalizeUsername(rawDraft.faceBook, FIELD_LIMITS.faceBook),
    instagram: normalizeUsername(rawDraft.instagram, FIELD_LIMITS.instagram),
    description: compactText(rawDraft.description, FIELD_LIMITS.description),
    specialisation: compactText(
      rawDraft.specialisation,
      FIELD_LIMITS.specialisation,
    ),
    qualifications: compactText(rawDraft.qualifications, FIELD_LIMITS.qualifications),
    specialisationOne: compactText(
      rawDraft.specialisationOne,
      FIELD_LIMITS.specialisationOne,
    ),
    specialisationTwo: compactText(
      rawDraft.specialisationTwo,
      FIELD_LIMITS.specialisationTwo,
    ),
    specialisationThree: compactText(
      rawDraft.specialisationThree,
      FIELD_LIMITS.specialisationThree,
    ),
    specialisationFour: compactText(
      rawDraft.specialisationFour,
      FIELD_LIMITS.specialisationFour,
    ),
    keywords: uniqueList(
      (Array.isArray(rawDraft.keywords) ? rawDraft.keywords : [])
        .map(normalizeKeyword)
        .filter((keyword) => keyword && keyword.length >= 3),
    ).slice(0, 5),
  };

  const missingFields = uniqueList([
    ...(Array.isArray(rawDraft.missingFields) ? rawDraft.missingFields : [])
      .filter((field) => MISSING_FIELD_NAMES.includes(field)),
    ...deriveMissingFields(draft),
  ]);

  const warnings = uniqueList([
    ...(Array.isArray(rawDraft.warnings) ? rawDraft.warnings : [])
      .map((warning) => compactText(warning, 180)),
    DEFAULT_WARNING,
  ]).slice(0, 5);

  return {
    draft,
    missingFields,
    warnings,
  };
};

const buildUserPrompt = ({ input, currentProfile = {} }) => {
  const allowedCurrentProfile = {
    location: compactText(currentProfile.location, FIELD_LIMITS.location),
    telephoneNumber: compactText(
      currentProfile.telephoneNumber,
      FIELD_LIMITS.telephoneNumber,
    ),
    websiteUrl: compactText(currentProfile.websiteUrl, FIELD_LIMITS.websiteUrl),
    faceBook: normalizeUsername(currentProfile.faceBook, FIELD_LIMITS.faceBook),
    instagram: normalizeUsername(currentProfile.instagram, FIELD_LIMITS.instagram),
    description: compactText(currentProfile.description, FIELD_LIMITS.description),
    specialisation: compactText(
      currentProfile.specialisation,
      FIELD_LIMITS.specialisation,
    ),
    qualifications: compactText(
      currentProfile.qualifications,
      FIELD_LIMITS.qualifications,
    ),
    specialisationOne: compactText(
      currentProfile.specialisationOne,
      FIELD_LIMITS.specialisationOne,
    ),
    specialisationTwo: compactText(
      currentProfile.specialisationTwo,
      FIELD_LIMITS.specialisationTwo,
    ),
    specialisationThree: compactText(
      currentProfile.specialisationThree,
      FIELD_LIMITS.specialisationThree,
    ),
    specialisationFour: compactText(
      currentProfile.specialisationFour,
      FIELD_LIMITS.specialisationFour,
    ),
    keywords: uniqueList(
      (Array.isArray(currentProfile.keywords) ? currentProfile.keywords : [])
        .map(normalizeKeyword),
    ).slice(0, 5),
  };

  return `Natural-language profile input:
${input}

Existing profile context, if useful:
${JSON.stringify(allowedCurrentProfile)}`;
};

export const isProfileDraftAIEnabled = () =>
  process.env.AI_PROFILE_DRAFT_ENABLED === 'true';

export const getProfileDraftModel = () =>
  process.env.OPENAI_PROFILE_DRAFT_MODEL ||
  process.env.OPENAI_MODEL ||
  DEFAULT_PROFILE_DRAFT_MODEL;

export const createProfileDraft = async ({ input, currentProfile }) => {
  if (!isProfileDraftAIEnabled() || !process.env.OPENAI_API_KEY) {
    throw new Error('AI profile drafting is temporarily unavailable.');
  }

  const llm = new ChatOpenAI({
    model: getProfileDraftModel(),
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 2,
    timeout: 30000,
  });

  const structuredLlm = llm.withStructuredOutput(profileDraftOutputSchema, {
    name: 'BodyVantageProfileDraft',
    strict: true,
  });

  const result = await structuredLlm.invoke([
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: buildUserPrompt({ input, currentProfile }),
    },
  ]);

  return normalizeProfileDraft(result);
};
