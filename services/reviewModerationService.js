const OFFENSIVE_TERMS = [
  'bastard',
  'bitch',
  'fuck',
  'idiot',
  'moron',
  'shit',
];

const THREAT_TERMS = ['kill you', 'hurt you', 'pay for this', 'destroy you'];
const PROMOTIONAL_TERMS = ['discount code', 'promo code', 'buy now', 'limited offer'];
const DISCRIMINATORY_PATTERNS = [
  /\bgo back to (?:your|their) country\b/i,
  /\bpeople like you\b/i,
  /\b(?:race|religion|disability|gender|sexuality) (?:is|are) (?:inferior|disgusting|wrong)\b/i,
];
const GENERATED_SPAM_PATTERNS = [
  /\bas an ai language model\b/i,
  /\bhere (?:is|are) (?:a|the) (?:review|response)\b/i,
  /#{2,}\s+(?:review|summary|conclusion)/i,
];

const findTerms = (text, terms) =>
  terms.filter((term) => text.toLowerCase().includes(term));

export const screenReview = (comment, existingComments = []) => {
  const text = String(comment || '').trim();
  const flags = [];
  const flaggedKeywords = [
    ...findTerms(text, OFFENSIVE_TERMS),
    ...findTerms(text, THREAT_TERMS),
    ...findTerms(text, PROMOTIONAL_TERMS),
  ];

  if (findTerms(text, OFFENSIVE_TERMS).length) flags.push('offensive_language');
  if (findTerms(text, THREAT_TERMS).length) flags.push('threatening_language');
  if (findTerms(text, PROMOTIONAL_TERMS).length) flags.push('promotional_content');
  if (DISCRIMINATORY_PATTERNS.some((pattern) => pattern.test(text))) {
    flags.push('discriminatory_content');
  }
  if (GENERATED_SPAM_PATTERNS.some((pattern) => pattern.test(text))) {
    flags.push('suspicious_generated_spam');
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) flags.push('email_address');
  if (/(?:\+?\d[\d\s().-]{7,}\d)/.test(text)) flags.push('phone_number');
  if (/\b\d{1,5}\s+[A-Za-z][A-Za-z.' -]{2,}\s(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|court|way)\b/i.test(text)) {
    flags.push('home_address');
  }

  const links = text.match(/(?:https?:\/\/|www\.)\S+/gi) || [];
  if (links.length) flags.push(links.length > 1 ? 'excessive_links' : 'external_link');

  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  if (existingComments.some((value) => String(value).toLowerCase().replace(/\s+/g, ' ') === normalized)) {
    flags.push('duplicate_content');
  }
  if (/(.)\1{7,}/i.test(text) || /\b(.{3,25})\s+\1\s+\1\b/i.test(text)) {
    flags.push('spam_pattern');
  }

  const highRiskFlags = new Set([
    'threatening_language',
    'discriminatory_content',
    'email_address',
    'phone_number',
    'home_address',
  ]);
  const riskLevel = flags.some((flag) => highRiskFlags.has(flag))
    ? 'high'
    : flags.length
      ? 'medium'
      : 'low';

  return {
    riskLevel,
    flags: [...new Set(flags)],
    flaggedKeywords: [...new Set(flaggedKeywords)],
    screenedAt: new Date(),
  };
};

export const isPublicReview = (review) => !review.status || review.status === 'published';

export const buildProfileStatsPipeline = () => [
  {
    $set: {
      _publicReviewsForStats: {
        $filter: {
          input: { $ifNull: ['$reviews', []] },
          as: 'review',
          cond: {
            $eq: [{ $ifNull: ['$$review.status', 'published'] }, 'published'],
          },
        },
      },
    },
  },
  {
    $set: {
      numReviews: { $size: '$_publicReviewsForStats' },
      rating: {
        $cond: [
          { $gt: [{ $size: '$_publicReviewsForStats' }, 0] },
          { $avg: '$_publicReviewsForStats.rating' },
          0,
        ],
      },
    },
  },
  { $unset: '_publicReviewsForStats' },
];
