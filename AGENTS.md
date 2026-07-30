# AGENTS.md

## Project Context (start with @docs/)

### docs/README.md
- API docs index with entry points for backend work.
- Highlights: ENV configuration and security improvements.
- Keyword search migration docs: architecture, fix summary, migration steps.

### docs/ENV_CONFIGURATION.md
- Required env vars: `NODE_ENV`, `PORT`, `MONGO_URI` (or `MONGODB_URI`), `JWT_SECRET`, mailer settings, Cloudinary settings, reset URL.
- Startup validation enforces required vars; warnings and blocking conditions vary by `NODE_ENV`.
- Production guidance: strong `JWT_SECRET` (32+ chars), HTTPS URLs, production credentials.
- Email features: verification, password reset, email change, password change notification.
- Mongo URI validation (must be `mongodb://` or `mongodb+srv://`).
- Last updated: 2025-12-31.

### docs/SECURITY_IMPROVEMENTS.md
- Fixes: account enumeration, input validation, password reset token hashing + expiry, token type separation, rate limiting, email change verification, TLS enforcement.
- New features: verification endpoints, audit logging to `logs/`, environment validation.
- Updated files: `controllers/userController.js`, `models/userModel.js`, `routes/userRoutes.js`, `server.js`, `utils/generateToken.js`.
- Added dependencies: `joi`, `express-rate-limit`, `winston`.
- Includes testing checklist and breaking changes for frontend (login/registration/password reset flow).

### docs/ROUTES.md
- Full API route index with method, auth, and handler mapping.

### docs/QUALIFICATION_DOCUMENT_MANUAL_TESTS.md
- Step-by-step backend manual verification scenarios for qualification-document routes.

### ../docs/subscription-login-checkout-handoff.md
- Current source of truth for the June 2026 subscription/login/checkout regression fix.
- Login is authentication only; successful login should not redirect to `/subscribe`.
- Checkout creation returns only the Stripe URL; checkout success verifies `session_id` through `GET /api/checkout-session/:sessionId` before hydrating login state.
- Login and `GET /api/users/profile` reconcile subscription state from Stripe when the user has `stripeCustomerId` or `stripeSubscriptionId`.
- Historic paid users missing both Stripe IDs require audit/backfill; login cannot safely infer them.

### docs/KEYWORD_SEARCH_ARCHITECTURE.md
- Replaces keyword permutation string with normalized `keywords` array.
- Adds MongoDB text index with weighted fields (name, keywords, specialisation, location, description).
- Search uses `$text` with relevance scoring and fallback sorting.
- Syncs `keywords` from individual keyword fields on profile update.
- Migration script: `api/scripts/migrateKeywords.js` (transactional, idempotent).
- API usage examples for search and filters.

### docs/KEYWORD_SEARCH_FIX_SUMMARY.md
- Root cause: frontend permutations created 1,378+ char `keyWordSearch` string, causing 400 errors.
- Fix summary: remove permutations, add `keywords` array, `$text` search, migration script.
- File changes across backend, frontend, and docs; includes performance impact and rollback plan.

### docs/MIGRATION_STEPS.md
- Quick start migration: optional backup, run `node api/scripts/migrateKeywords.js`, verify indexes and profile updates.
- Validation checklist for post-migration.
- Troubleshooting and rollback guidance.

## Project Map (entrypoints, modules, and flow)

### Entrypoints
- `server.js`: Express app bootstrap, env validation, DB connect, security middleware, routes, error handling, health check, optional static frontend.
- `config/db.js`: MongoDB connection setup (imported by `server.js`).
- `config/validateEnv.js`: Environment variable validation (called at startup).

### Routes -> Controllers
- `routes/userRoutes.js` -> `controllers/userController.js`
- `routes/confirmEmailRoutes.js` -> `controllers/confirmEmailController.js`
- `routes/contactFormRoutes.js` -> `controllers/contactFormController.js`
- `routes/profileRoutes.js` -> `controllers/profileController.js`
- `routes/qualificationDocumentRoutes.js` -> `controllers/qualificationDocumentController.js`
- `routes/userReviewRoutes.js` -> `controllers/userReviewsController.js`
- `routes/imageUploadRoutes.js` -> `controllers/imageUploadController.js`
- `routes/profileImageRoutes.js` -> `controllers/imageUploadController.js` (profile upload path)
- `routes/stripeRoutes.js` -> `controllers/stripeWebhookController.js` (webhook handled in `server.js` with raw body)
- `routes/analyticsRoutes.js` -> `controllers/analyticsController.js`

### Models (Mongoose)
- `models/userModel.js`
- `models/profileModel.js`
- `models/qualificationDocumentModel.js`
- `models/userReviewerModel.js`
- `models/imageUploadModal.js`
- `models/profileImageModel.js`
- `models/searchEventModel.js`
- `models/loginEventModel.js`

### Middleware
- `middleware/authMiddleware.js`: auth gate/role protection.
- `middleware/qualificationDocumentUploadMiddleware.js`: multer-based qualification document upload parsing and file validation.
- `middleware/validationMiddleware.js`: request validation wiring.
- `middleware/rateLimitMiddleware.js`: general + endpoint rate limiters.
- `middleware/errorMiddleware.js`: notFound + error handler.

### Services / Utils
- `services/emailService.js`: email orchestration.
- `services/stripeService.js`: Stripe integration helpers.
- `services/analyticsService.js`: membership/onboarding aggregation,
  search-demand/supply aggregation, and privacy-minimised search-event capture.
- `services/loginAnalyticsService.js`: privacy-minimised successful member-login
  capture and engagement aggregation; 400-day TTL, no IP/user-agent storage.
- `services/stripeAnalyticsService.js`: paginated/cached Stripe invoice and
  subscription analytics.
- `utils/emailService.js`: transporter init + low-level email helpers.
- `utils/generateToken.js`: JWT helpers (token types).
- `utils/profileHelpers.js`: keyword and qualification-summary sync helpers for profiles.
- `utils/auditLogger.js`: security event logging to `logs/`.

### Scripts
- `scripts/migrateKeywords.js`: keywords migration and text index verification.
- `scripts/backfillQualificationVerificationStatus.js`: backfills `qualificationVerificationStatus` from legacy `isQualificationsVerified` values.
- `scripts/backfillQualificationDocumentResourceTypes.js`: backfills qualification document Cloudinary resource types from live Cloudinary metadata.
- `scripts/ensureAnalyticsIndexes.js`: creates/verifies analytics TTL and
  deduplication indexes and removes obsolete retained raw search queries.
- `scripts/verifyStripeConfiguration.js`: safe Stripe account/Price deployment
  probe without printing configured identifiers or credentials.

## Dependencies (runtime highlights)
- Server: `express`, `cors`, `helmet`, `express-mongo-sanitize`, `express-rate-limit`, `dotenv`.
- Auth/Security: `jsonwebtoken`, `bcryptjs`, `validator`, `joi`.
- Data: `mongoose`.
- Email/Media: `nodemailer`, `cloudinary`, `multer`.
- Payments/Logs: `stripe`, `winston`.

## Common Workflows (commands)
- Install: `npm install`
- Dev server (nodemon): `npm run server`
- Start (node): `npm start`
- Tests: `npm test` (currently placeholder; exits with error)
- Keyword migration: `node scripts/migrateKeywords.js`
- Qualification status backfill: `node scripts/backfillQualificationVerificationStatus.js`
- Qualification document resource type backfill: `node scripts/backfillQualificationDocumentResourceTypes.js`
- Analytics index migration/verification: `npm run ensure:analytics-indexes`
- Stripe account/Price verification: `npm run verify:stripe`

## Project Skills (from .git/skills/)

### backend-developer
- Description: Node.js/Express backend architecture, security, performance, testing, observability, deployment.
- Path: `.git/skills/backend-developer/SKILL.md`
- Notes: Emphasizes layered architecture, validation, centralized error handling, rate limiting, and structured review output.

### mongo-db-developer
- Description: MongoDB schema design, access control, security, performance, scaling, ops best practices.
- Path: `.git/skills/mongo-db-developer/SKILL.md`
- Notes: Focus on tenant isolation strategies, indexing, transactions, and backup/monitoring guidance.

### pr-reviewer
- Description: Structured PR review (functionality, style, security, tests, maintainability).
- Path: `.git/skills/pr-reviewer/SKILL.md`
- Notes: Requires severity-ordered issues, file/line references, and clear approval recommendation.

### prd-writer
- Description: PRD generator with clarifying questions and structured output saved to `tasks/`.
- Path: `.git/skills/prd-writer/SKILL.md`
- Notes: Ask 3-5 critical questions with lettered options; produce PRD sections and save to `tasks/prd-[feature].md`.

## Routes Index (HTTP + auth)

### Auth & Users
- `POST /api/users/login` -> `authUser` (public, login rate limit)
- `POST /api/users` -> `registerUser` (public, registration rate limit)
- `GET /api/users` -> `getAllUsersProfile` (admin)
- `GET /api/users/profile` -> `getUserProfile` (auth)
- `PUT /api/users/profile` -> `updateUserProfile` (auth)
- `GET /api/user/profile/:id` -> `getUserProfileById` (public)
- `GET /api/users/:id` -> `getUserProfileById` (admin)
- `DELETE /api/users/:id` -> `deleteUser` (admin; blocks deletion while live
  Stripe billing is active/trialing or cannot be safely reconciled)
- `PUT /api/user/profile/:id` -> `updateIsAdmin` (admin)
- `POST /api/user-forgot-password` -> `userForgotPassword` (public, rate limit)
- `PUT /api/user-update-password` -> `updateUserProfilePassword` (public)
- `GET /api/verify` -> `verifyEmail` (public)
- `GET /api/verify-email-change` -> `verifyEmailChange` (public)

### Reviewer Accounts
- `POST /api/users-review/login` -> `authUserReview` (public)
- `POST /api/users-review` -> `registerUserReviewer` (public)
- `GET /api/reviewers/admin` -> `getAllUsersReviews` (admin, validated
  pagination/search/status filters, explicit safe reviewer DTO)
- `GET /api/reviewers/me` -> `getAllUsersReviewers` (reviewer JWT, explicit
  safe self DTO)
- `DELETE /api/reviewer/admin/:id` -> `deleteReviewer` (admin, validated id;
  deletion-pending guard plus atomic retained-review anonymisation/account
  removal)
- `POST /api/reviewer-forgot-password` -> `reviewerForgotPassword` (public)
- `PUT /api/reviewer-update-password` -> `updateReviewerPassword` (public)

### Profiles
- `GET /api/profile/qualification-documents` -> `getQualificationDocuments` (auth)
- `POST /api/profile/qualification-documents` -> `uploadQualificationDocument` (auth, qualification-document mutation rate limit)
- `PUT /api/profile/qualification-documents/:id` -> `replaceQualificationDocument` (auth, qualification-document mutation rate limit)
- `DELETE /api/profile/qualification-documents/:id` -> `deleteQualificationDocument` (auth, qualification-document mutation rate limit)
- `GET /api/profiles/admin/qualification-documents` -> `getQualificationDocumentsAdmin` (admin)
- `PATCH /api/profiles/admin/qualification-documents/:id/review` -> `reviewQualificationDocument` (admin, qualification-document review rate limit)
- `GET /api/profiles` -> `getAllProfiles` (public, pagination + search)
- `POST /api/profiles` -> `createProfile` (auth)
- `GET /api/profiles/:id` -> `getProfileById` (public)
- `GET /api/profile/:id` -> `getProfileById` (public, backward compat)
- `GET /api/profile` -> `getProfile` (auth)
- `PUT /api/profile` -> `updateProfile` (auth)
- `PATCH /api/profile/onboarding-tutorial` -> `updateOnboardingTutorialStatus` (auth)
- `PUT /api/profile-clicks` -> `updateProfileClicks` (public)
- `POST /api/profiles/:id/reviews` -> `createProfileReview` (auth, review rate
  limit; atomic reviewer/profile write and deletion-race guards)
- `DELETE /api/profiles/:id/reviews` -> `deleteReview` (admin)
- `GET /api/profiles/admin` -> `getAllProfilesAdmin` (admin, validated
  pagination/search/qualification/sort filters, explicit list projection)
- `GET /api/profiles/admin/:id/reviews` -> `getProfileReviewsAdmin` (admin,
  validated pagination, published-review DTO)
- `DELETE /api/profiles/admin/:id` -> `deleteProfile` (admin; atomically marks
  the profile deleting, transactionally removes profile media/document
  records, then performs deduplicated best-effort external cleanup with legacy
  resource-type fallback)
- `PUT /api/profiles/admin/:id` -> `updateProfileQualificationToTrue` (admin)
- `GET /api/profile-images` -> `getAllProfileImages` (auth)
- `GET /api/profile-images-public/:id` -> `getAllProfileImagesPublic` (public)

### Email Verification (legacy)
- `GET /api/verify?token=...` -> `updateConfirmEmail` (public, legacy compatibility)
- `GET /api/verify/token=:id` -> `updateConfirmEmail` (public)
- `GET /api/verifyReviewer?token=...` -> `updateConfirmReviewerEmail` (public)
- `GET /api/verifyReviewer/token=:id` -> `updateConfirmReviewerEmail` (public)

### Contact Form
- `POST /api/send` -> `sendContactForm` (public)

### Media Uploads
- `POST /api/userProfileUpload` -> `userProfileImageUpload` (auth, multer)
- `DELETE /api/profile-image/:id` -> `deleteProfileImage` (auth)
- `POST /api/profileUpload` -> profile image upload (auth, inline controller in route)

### Stripe
- `POST /api/stripe/webhook` -> `stripeWebhookHandler` (public, raw body)
- `POST /api/checkout-session` -> `createCheckoutSession` (public, rate limit)
- `POST /api/create-subscription` -> `createSubscription` (auth)

### Analytics
- `GET /api/admin/analytics/overview` -> `getAnalyticsOverview` (admin;
  validated months/search window/timezone).
- `POST /api/analytics/search-events` -> `captureSearchEvent` (public,
  rate-limited, deduplicated, session-hashed, 180-day TTL).
- Keep `dataQualityWarnings` in the response/UI. The current warning identifies
  MongoDB paid members that cannot be reconciled with the configured Stripe
  account; see `docs/ANALYTICS.md`.

## Data Flow (high-level)

### Request lifecycle
- `server.js`: load env -> validate -> connect DB -> init email -> apply security + CORS + parsers + sanitize -> rate limit -> routes -> error handlers.

### Auth flow
- Login: `POST /api/users/login` -> subscription reconciliation -> schedule a
  failure-isolated non-admin `LoginEvent` plus durable
  `lastSuccessfulLoginAt` -> JWT returned without waiting for analytics ->
  `Authorization: Bearer <token>` -> `protect` middleware -> `req.user`.
- Email verification: registration sends verification token -> `GET /api/verify?token=...` sets `isConfirmed`.
- Password reset: `POST /api/user-forgot-password` -> email with token -> `PUT /api/user-update-password` validates token + updates password.

### Profile flow
- Create: `POST /api/profiles` creates base profile.
- Update: `PUT /api/profile` updates whitelisted fields -> `syncKeywordsArray` -> save.
- Search: `GET /api/profiles?search=...` uses Mongo `$text` index and weighted relevance.
- Reviews: reviewer auth + verified -> `POST /api/profiles/:id/reviews` -> stats recomputed.

### Stripe flow
- Checkout: `POST /api/checkout-session` creates user if needed, sends verification email, returns Stripe hosted checkout URL.
- Checkout success: `GET /api/checkout-session/:sessionId` verifies Stripe session, syncs subscription state, and returns tokenized user payload.
- Webhook: `POST /api/stripe/webhook` validates signature, updates subscription status on `checkout.session.completed`, `invoice.*`, `customer.subscription.*`.
- Login and current-user profile reads also reconcile subscription state from Stripe when Stripe IDs exist.

### Analytics flow
- Admin overview -> Mongo membership/login/search aggregations + independent
  cached Stripe aggregation -> one response with partial-failure and
  completeness metadata.
- Member-level engagement ranks only current active paid members: top ten by
  successful sign-ins in the rolling 30 days and up to ten with no sign-in in
  that window. Identity is resolved from current `User` records only for the
  admin-protected response; it is never copied into `LoginEvent`.
- Member health uses the same active-paid cohort and explicit 7/30/60-day
  recency bands plus a separate `unmeasured` segment. Do not merge cold-start
  members into `atRisk`.
- Onboarding is a cumulative current-state funnel: registered -> email
  verified -> active paid -> profile -> tutorial -> core details ->
  qualification approved.
- Search demand/supply compares structured profession/location demand with
  exact normalized main-field supply from currently discoverable profiles.
- Stripe results paginate list APIs, filter subscription invoices by actual
  payment time, use item-level renewal dates, group money by currency, use an
  eight-second timeout, and cache for 10 minutes with stale fallback.
- Page-one non-empty profile search -> short-lived signed
  `analyticsReceipt`; settled capture -> receipt verification -> derived
  `SearchEvent`. Raw query/IP are not stored, session is hashed, and TTL
  deletion is 180 days.
- Successful non-admin member login -> `LoginEvent`; only member ID and
  timestamps are stored, admins/reviewers are excluded, TTL deletion is 400
  days, and capture failure never blocks authentication.
- If MongoDB has active paid members and Stripe returns zero subscriptions,
  emit `dataQualityWarnings`. Do not remove this warning to conceal an
  environment mismatch.

## Where To Look First
- Auth + user lifecycle: `routes/userRoutes.js`, `controllers/userController.js`, `models/userModel.js`, `utils/generateToken.js`.
- Reviewer accounts: `routes/userReviewRoutes.js`, `controllers/userReviewsController.js`, `models/userReviewerModel.js`.
- Profiles + search: `routes/profileRoutes.js`, `controllers/profileController.js`, `models/profileModel.js`, `utils/profileHelpers.js`.
- Qualification documents: `routes/qualificationDocumentRoutes.js`, `controllers/qualificationDocumentController.js`, `models/qualificationDocumentModel.js`, `validators/qualificationDocumentValidator.js`, `middleware/qualificationDocumentUploadMiddleware.js`.
- Email sending: `services/emailService.js`, `utils/emailService.js`.
- Stripe: `routes/stripeRoutes.js`, `controllers/stripeWebhookController.js`, `services/stripeService.js`, `config/stripe.js`.
- Analytics: `routes/analyticsRoutes.js`,
  `controllers/analyticsController.js`, `services/analyticsService.js`,
  `services/loginAnalyticsService.js`, `services/stripeAnalyticsService.js`,
  `models/searchEventModel.js`, `models/loginEventModel.js`,
  `validators/analyticsValidator.js`, `utils/analyticsQueries.js`,
  `utils/timezone.js`, `utils/searchAnalyticsReceipt.js`,
  `docs/ANALYTICS.md`.
- Security middleware + logging: `middleware/authMiddleware.js`, `middleware/rateLimitMiddleware.js`, `middleware/errorMiddleware.js`, `utils/auditLogger.js`.
- Env validation: `config/validateEnv.js`.

## Data Models (MongoDB)

### User (`models/userModel.js`)
- Identity: `name`, `email` (unique), `password` (bcrypt).
- Roles/status: `isAdmin`, `isConfirmed`.
- Media: `profileImage`, `cloudinaryId`.
- Password reset: `resetPasswordToken`, `resetPasswordTokenExpiry`, `resetPasswordAttempts`, `resetPasswordLastAttempt`.
- Email change flow: `pendingEmail`, `emailChangeToken`, `emailChangeTokenExpiry`.
- Stripe: `stripeCustomerId`, `stripeSubscriptionId`, `isSubscribed`, `plan`, `currentPeriodEnd`, `paymentStatus`.
- Engagement: privacy-minimal `lastSuccessfulLoginAt`.

### LoginEvent (`models/loginEventModel.js`)
- Privacy-minimal engagement event for successful non-admin member logins.
- Fields: `userId`, fixed `accountType=member`, `occurredAt`, `expiresAt`.
- No email, name, IP, user agent, token, or Stripe data.
- TTL expiry: 400 days; indexed by account/time and member/time.
- Current health uses User `lastSuccessfulLoginAt`; deleting the User removes
  linked LoginEvents in the same database transaction.

### Profile (`models/profileModel.js`)
- Owner: `user` (unique per user).
- Public fields: `name`, `email` (sparse unique), `profileImage`, `description`, `specialisation`, `location`, `telephoneNumber`, socials.
- Verification summary: `isQualificationsVerified`, `qualificationVerificationStatus`, `qualificationStatusUpdatedAt`.
- Keywords: `keywords` array (max 5) + legacy `keyWordSearchOne..Five`.
- Specialisation fields: `specialisationOne..Four`.
- Reviews: embedded `reviews` (rating/comment/showName/userProfileId/hasAccepted).
- Stats: `rating`, `numReviews`, `profileClickCounter`.
- Indexes: text search index + filters/sorting indexes.

### QualificationDocument (`models/qualificationDocumentModel.js`)
- Ownership: `user`, `profile`.
- File metadata: `originalFileName`, `mimeType`, `fileSizeBytes`, `cloudinaryPublicId`, `cloudinaryResourceType`.
- Review state: `status`, `rejectionReason`, `reviewedAt`, `reviewedBy`.
- Lifecycle: `isActive`, `supersededAt`.
- Indexes: active profile lookup, user history, admin status queue, review audit lookup.

### UserReviewer (`models/userReviewerModel.js`)
- Identity: `name`, `email` (unique), `password`.
- Status: `isConfirmed`, `hasSubmittedReview`.
- Password reset: `resetPasswordToken`, `resetPasswordTokenExpiry`, `resetPasswordAttempts`, `resetPasswordLastAttempt`.

### Media Models
- `UserProfileImages` (`models/imageUploadModal.js`): per-user account images (`avatar`, `cloudinaryId`).
- `ProfileImages` (`models/profileImageModel.js`): profile gallery images (`avatar`, `cloudinaryId`).

## Test Checklist (quick, manual)

### Auth & Users
- Register -> verification email sent -> `GET /api/verify?token=...` confirms -> login works.
- Login rejects unverified users with 401 + message.
- Password reset: request -> email -> reset token -> password updated.
- Email change: update profile with new email -> verification email -> `GET /api/verify-email-change?token=...` updates email.
- Admin: list users, update admin flag, delete user (checks cascading deletes + Cloudinary cleanup).

### Reviewer Accounts
- Register reviewer -> verification email -> login.
- Submit review blocked if reviewer email not confirmed.
- Reviewer password reset request + confirm.

### Profiles & Search
- Create profile on first auth -> fetch `/api/profile`.
- Update profile fields -> keywords auto-sync -> search returns relevant matches.
- Reviews: create + delete, ratings recalc, acceptConditions enforced.
- Profile clicks increments by 1 server-side.

### Media Uploads
- Upload user profile image (`/api/userProfileUpload`) -> image stored + Cloudinary URL.
- Upload profile image (`/api/profileUpload`) -> profile updated.
- Delete profile image -> Cloudinary cleanup.

### Qualification Documents
- Upload qualification document -> active document becomes `pending`, an audit log entry is written, and the request stays below the mutation limiter.
- Replace and delete qualification documents while under the limit -> requests succeed and profile summary stays aligned.
- Exceed 10 qualification-document mutation requests within 15 minutes as the same authenticated user -> API returns `429`.
- Admin review approve/reject -> active submission status and profile summary are updated and an admin audit log entry is written.
- Exceed 60 admin review actions within 15 minutes as the same admin -> API returns `429`.
- Reject unsupported file types and oversize files -> API returns `400`.
- Authorization checks: unauthenticated upload is rejected; non-owner delete is rejected; non-admin review is rejected.
- Full step-by-step API scenarios are documented in `docs/QUALIFICATION_DOCUMENT_MANUAL_TESTS.md`.

### Stripe
- Checkout session -> user created if needed -> verification email sent.
- Webhook: `checkout.session.completed` sets subscription + plan + period end.
- `invoice.payment_failed` sets `paymentStatus=failed`; subscription deleted sets `isSubscribed=false`.

## Deployment / Runbook
- Ensure `.env` includes required vars (see `docs/ENV_CONFIGURATION.md`); use strong `JWT_SECRET` for production.
- Start dev server: `npm run server` (nodemon).
- Start prod server: `npm start`.
- Optional monorepo serving: set `SERVE_FRONTEND=true` to serve `client/dist`.
- Stripe webhook: keep `/api/stripe/webhook` before JSON body parser (already configured) and set `STRIPE_WEBHOOK_SECRET`.
- Health check: `GET /` returns status, environment, timestamp.
- Logs: security events in `logs/`, errors via `utils/auditLogger.js`.

## Security Checklist
- CORS: ensure `FRONTEND_URL`, `RESET_PASSWORD_LOCAL_URL`, `MAILER_LOCAL_URL` are set; only approved origins should pass.
- Rate limits: login/registration/reset + general `/api` limiter enabled; tune for production traffic.
- Qualification document mutation and admin review endpoints have dedicated per-user/per-admin rate limits in addition to the general `/api` limiter.
- Headers: `helmet` enabled with CSP + HSTS; review CSP when adding new assets.
- Input validation: Joi schemas for auth + profile updates; keep validators in sync with models.
- Secrets: rotate `JWT_SECRET`, SMTP credentials, Cloudinary keys, Stripe secrets; never commit `.env`.
- Data protection: `express-mongo-sanitize` enabled; avoid direct use of user-provided query fragments.
- Email flows: verify token types (`email_verification`, `password_reset`, `email_change`) before trust.

## Troubleshooting
- Server won’t start: check `.env` required variables and `validateEnv` output.
- Mongo connection fails: verify `MONGO_URI`/`MONGODB_URI` format and network access.
- CORS errors: confirm request origin is in allowed origins list.
- Password reset fails: ensure token type is `password_reset` and not expired (15 minutes).
- Stripe webhooks fail: verify raw body is enabled and `STRIPE_WEBHOOK_SECRET` matches.
- Upload fails: for image endpoints confirm `jpg/jpeg/png`; for qualification-document endpoints confirm `PDF/JPG/PNG` with multipart field `qualificationDocument`, file size <= `5MB`, and Cloudinary credentials.
- Search returns empty: ensure `profile_search_index` exists and `keywords` array is populated.

## Changelog Stub
- 2026-02-06: Added project map, routes index, data flows, model summaries, test checklist, runbook, and security/troubleshooting notes.

## Request/Response Examples (quick sanity)
- Login: `POST /api/users/login` -> `{ email, password }` => `{ _id, name, email, isAdmin, token }`.
- Register: `POST /api/users` -> `{ name, email, password }` => `{ _id, name, email, isAdmin, isConfirmed, token, message }`.
- Get profile: `GET /api/profile` (auth) => profile object or `null`.
- Update profile: `PUT /api/profile` (auth) -> profile fields => updated profile object.
- Search profiles: `GET /api/profiles?search=fitness&page=1&limit=20` => `{ profiles, page, pages, total, hasSearch }`.
- Create review: `POST /api/profiles/:id/reviews` (auth) -> `{ rating, comment, showName, userProfileId, acceptConditions }`.

## Migration History (known)
- Keyword search migration: `scripts/migrateKeywords.js` (see `docs/KEYWORD_SEARCH_*`).
- Qualification status backfill: `scripts/backfillQualificationVerificationStatus.js` (maps legacy boolean verification to status enum for existing profiles).

## Dependency Update Policy (suggested)
- Monthly: `npm audit` + update minor/patch versions.
- Quarterly: review major updates (Express/Mongoose/Stripe) with staging tests.
- Security hotfixes: apply immediately with smoke tests (auth, profile, Stripe, upload).

## Observability Notes
- Audit log: `utils/auditLogger.js` writes to `logs/`.
- Qualification-document lifecycle events are written to `logs/audit.log` with actor, target user, profile, and document identifiers.
- Server log: stdout/stderr; consider log rotation in production.
- Add request correlation ID middleware if tracing is needed.

## Environment Matrix (key flags)
- `NODE_ENV`: `development` vs `production` affects validation strictness and error logging.
- `SERVE_FRONTEND=true`: serves `client/dist` if present.
- `STRIPE_WEBHOOK_SECRET`: required for webhook verification.

## Data Privacy / PII Touchpoints
- User email, password (hashed), and profile data stored in MongoDB.
- Emails sent via SMTP (verification, reset, notifications).
- Cloudinary stores media; Cloudinary IDs saved in DB.

## Known TODOs / Gaps
- Automated tests are not wired (`npm test` placeholder).
- Consider centralizing contact form email transport (currently in controller).

## Permissions Matrix (public/auth/admin)
- Public: login, registration, email verification, password reset, profile listing/search, public profile fetch, public profile images.
- Auth: own profile get/update, profile creation, review creation, image uploads, create subscription.
- Admin: list users, delete users, update admin flag, profile admin list/delete/verify, review delete, reviewer admin delete/list.

## Data Retention / Logging Policy (suggested)
- Audit logs: keep 90 days (rotate + archive), redact tokens and passwords.
- Error logs: keep 30-90 days depending on storage; include request ID if added.
- Stripe events: store minimal event metadata if persistence is needed (id, type, timestamp).
- Cloudinary: remove images when user/profile is deleted (already handled in delete flow).

## Safe Refactor Checklist
- Update validators + models together when changing request shape.
- Preserve backward compatibility for public endpoints or add clear migration notes.
- Keep rate limits on auth-related endpoints.
- Update docs in `docs/` and `AGENTS.md` for new/changed routes.
- Add manual test notes for any new flow (auth, profile, Stripe, uploads).
