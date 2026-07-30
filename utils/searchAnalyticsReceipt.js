import crypto from 'crypto';

export const SEARCH_ANALYTICS_RECEIPT_TTL_MS = 5 * 60 * 1000;

export const normalizeSearchDimension = (value = '') => (
  String(value)
    .trim()
    .toLocaleLowerCase('en-GB')
    .replace(/\s+/g, ' ')
);

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

const signatureFor = (encodedPayload, secret) => (
  crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url')
);

const requireSecret = (secret) => {
  if (!secret) {
    throw new Error('Search analytics receipt secret is not configured.');
  }
  return secret;
};

const invalidReceipt = () => {
  const error = new Error('Expired or invalid search analytics receipt.');
  error.code = 'INVALID_SEARCH_ANALYTICS_RECEIPT';
  return error;
};

export const createSearchAnalyticsReceipt = ({
  query = '',
  profession = '',
  location = '',
  resultsCount,
  page = 1,
  source = 'homepage',
  now = new Date(),
  ttlMs = SEARCH_ANALYTICS_RECEIPT_TTL_MS,
  nonce = crypto.randomUUID(),
  secret = process.env.JWT_SECRET,
}) => {
  const normalizedCriteria = {
    query: normalizeSearchDimension(query),
    profession: normalizeSearchDimension(profession),
    location: normalizeSearchDimension(location),
  };
  if (!Object.values(normalizedCriteria).some(Boolean)) {
    return null;
  }

  const payload = {
    version: 1,
    ...normalizedCriteria,
    resultsCount: Number(resultsCount),
    page: Number(page),
    source,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    nonce,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signatureFor(encodedPayload, requireSecret(secret))}`;
};

export const verifySearchAnalyticsReceipt = (
  receipt,
  {
    now = new Date(),
    secret = process.env.JWT_SECRET,
  } = {},
) => {
  const [encodedPayload, suppliedSignature, ...extra] = String(receipt || '').split('.');
  if (!encodedPayload || !suppliedSignature || extra.length) {
    throw invalidReceipt();
  }

  const expectedSignature = signatureFor(encodedPayload, requireSecret(secret));
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length
    || !crypto.timingSafeEqual(supplied, expected)
  ) {
    throw invalidReceipt();
  }

  let payload;
  try {
    payload = JSON.parse(decode(encodedPayload));
  } catch {
    throw invalidReceipt();
  }

  const issuedAt = new Date(payload.issuedAt);
  const expiresAt = new Date(payload.expiresAt);
  const hasCriteria = ['query', 'profession', 'location']
    .some((key) => typeof payload[key] === 'string' && payload[key].length > 0);
  if (
    payload.version !== 1
    || !hasCriteria
    || !Number.isInteger(payload.resultsCount)
    || payload.resultsCount < 0
    || payload.page !== 1
    || !['homepage', 'directory'].includes(payload.source)
    || typeof payload.nonce !== 'string'
    || payload.nonce.length < 8
    || Number.isNaN(issuedAt.getTime())
    || Number.isNaN(expiresAt.getTime())
    || issuedAt.getTime() > now.getTime() + 30_000
    || expiresAt.getTime() <= now.getTime()
  ) {
    throw invalidReceipt();
  }

  return payload;
};

export const privacySafeQueryTokens = (value = '') => {
  const redacted = normalizeSearchDimension(value)
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, ' ')
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/g, ' ')
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, ' ');

  return [...new Set(
    redacted
      .split(/[^a-z0-9'-]+/i)
      .filter((token) => token.length >= 2 && token.length <= 30)
      .slice(0, 12),
  )];
};
