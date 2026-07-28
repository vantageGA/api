const isProduction = () => process.env.NODE_ENV === 'production';

export const getFrontendBaseUrl = () => {
  const environmentFallback = isProduction()
    ? process.env.RESET_PASSWORD_PRODUCTION_URL ||
      process.env.RESET_PASSWORD_LOCAL_URL
    : process.env.RESET_PASSWORD_LOCAL_URL ||
      process.env.RESET_PASSWORD_PRODUCTION_URL;

  const frontendUrl =
    process.env.CONFIRM_REDIRECT_URL ||
    process.env.FRONTEND_URL ||
    environmentFallback;

  if (!frontendUrl) {
    throw new Error('Frontend URL is not configured');
  }

  const parsedUrl = new URL(frontendUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Frontend URL must use HTTP or HTTPS');
  }

  return parsedUrl.origin;
};

export const buildFrontendUrl = (pathname, searchParams = {}) => {
  const url = new URL(pathname, getFrontendBaseUrl());

  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};
