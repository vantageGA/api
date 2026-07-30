# Routes Index

All routes are mounted under `/api` in `server.js` unless noted.

## Auth & Users
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/users/login` | Public | `authUser` | Login (rate limited). Auth only; does not decide subscription routing. Reconciles subscription state from Stripe before returning user data when Stripe IDs exist. |
| POST | `/users` | Public | `registerUser` | Registration (rate limited). |
| GET | `/users` | Admin | `getAllUsersProfile` | Safe paginated user list. Accepts `page` and `limit` (default 50, maximum 100) and returns `{ users, page, pages, total }`; authentication/reset/email-change/Stripe identifiers are excluded. |
| GET | `/users/profile` | Auth | `getUserProfile` | Current user profile. Reconciles subscription state from Stripe before returning user data when Stripe IDs exist. |
| PUT | `/users/profile` | Auth | `updateUserProfile` | Update current user (email change requires verification). |
| GET | `/user/profile/:id` | Public | `getUserProfileById` | Public user profile. |
| GET | `/users/:id` | Admin | `getUserProfileById` | Admin view of user by id. |
| DELETE | `/users/:id` | Admin | `deleteUser` | Validated id. Admin accounts must be demoted first. Live Stripe state is checked before deletion; active/trialing or unreconciled active billing returns `409`, and an unavailable Stripe check returns `503` without deleting local data. Eligible deletion transactionally removes the member, profile, media records, qualification documents, and login analytics before best-effort Cloudinary cleanup. |
| PUT | `/user/profile/:id` | Admin | `updateIsAdmin` | Validated id and boolean body. Only confirmed users can be promoted; self-demotion is blocked; response uses the safe admin-user allowlist. |
| POST | `/user-forgot-password` | Public | `userForgotPassword` | Password reset request (rate limited). |
| PUT | `/user-update-password` | Public | `updateUserProfilePassword` | Reset password with token. |
| GET | `/verify` | Public | `verifyEmail` | Email verification (token query). |
| GET | `/verify-email-change` | Public | `verifyEmailChange` | Email change verification (token query). |

## Reviewer Accounts
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/users-review/login` | Public | `authUserReview` | Reviewer login. |
| POST | `/users-review` | Public | `registerUserReviewer` | Reviewer registration. |
| GET | `/reviewers/admin` | Admin | `getAllUsersReviews` | Safe paginated reviewer list. Accepts `page`, `limit`, `search`, `isConfirmed`, and `hasSubmittedReview`; returns `{ reviewers, page, pages, total }`. |
| GET | `/reviewers/me` | Reviewer | `getAllUsersReviewers` | Safe account details for the authenticated reviewer. |
| DELETE | `/reviewer/admin/:id` | Admin | `deleteReviewer` | Validated id. Marks deletion in progress, then atomically anonymises retained embedded reviews and deletes the reviewer account. Reviewer authentication/submission excludes accounts being deleted. |
| POST | `/reviewer-forgot-password` | Public | `reviewerForgotPassword` | Reviewer reset request. |
| PUT | `/reviewer-update-password` | Public | `updateReviewerPassword` | Reviewer reset confirm. |

## Profiles
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| GET | `/profile/qualification-documents` | Auth | `getQualificationDocuments` | Current user qualification documents (paginated, optional `status` and `isActive` filters). |
| POST | `/profile/qualification-documents` | Auth | `uploadQualificationDocument` | Upload qualification document for current user (`qualificationDocument` field, PDF/JPG/PNG only, max 5MB, stored in Cloudinary as `raw` for PDF and `image` for JPG/PNG, mutation rate limited to 10 requests per 15 minutes per authenticated user). Upload/database state is transactionally coordinated with profile deletion. |
| PUT | `/profile/qualification-documents/:id` | Auth | `replaceQualificationDocument` | Replace an active qualification document (`qualificationDocument` field, PDF/JPG/PNG only, max 5MB, stored in Cloudinary as `raw` for PDF and `image` for JPG/PNG, mutation rate limited to 10 requests per 15 minutes per authenticated user). Upload/database state is transactionally coordinated with profile deletion. |
| DELETE | `/profile/qualification-documents/:id` | Auth | `deleteQualificationDocument` | Delete a qualification document owned by the current user (mutation rate limited to 10 requests per 15 minutes per authenticated user). |
| GET | `/profiles/admin/qualification-documents` | Admin | `getQualificationDocumentsAdmin` | Admin qualification document queue (paginated, optional `status` and `isActive` filters). |
| PATCH | `/profiles/admin/qualification-documents/:id/review` | Admin | `reviewQualificationDocument` | Approve or reject an active qualification document (review rate limited to 60 requests per 15 minutes per admin). |
| GET | `/profiles` | Public | `getAllProfiles` | Pagination + literal bounded search filters. Non-empty page-one criteria return a short-lived signed `analyticsReceipt` binding the server-observed total. |
| POST | `/profiles` | Auth | `createProfile` | Create profile. |
| GET | `/profiles/:id` | Public | `getProfileById` | Profile by id. |
| GET | `/profile/:id` | Public | `getProfileById` | Backward compatible alias. |
| GET | `/profile` | Auth | `getProfile` | Current user's profile. |
| PUT | `/profile` | Auth | `updateProfile` | Update current user's profile (blocked with `403 ONBOARDING_TUTORIAL_REQUIRED` when onboarding is incomplete and enforcement is enabled). |
| POST | `/profile/ai-draft` | Auth | `createProfileAIDraft` | Generate an OpenAI/LangChain structured profile draft from natural-language input. Requires `AI_PROFILE_DRAFT_ENABLED=true`, does not save the profile, and is rate limited per authenticated user. |
| PATCH | `/profile/onboarding-tutorial` | Auth | `updateOnboardingTutorialStatus` | Update onboarding tutorial interaction/completion state for current user. |
| PUT | `/profile-clicks` | Public | `updateProfileClicks` | Increments click counter (by id in body). |
| POST | `/profiles/:id/reviews` | Auth | `createProfileReview` | Reviewer creates a review (rate limited). Profile/reviewer writes are atomic; anonymised legacy reviews are accepted and reviewer/profile deletion races are rejected safely. |
| DELETE | `/profiles/:id/reviews` | Admin | `deleteReview` | Remove a published review. Requires `reviewId` and an audit `reason` in the request body. |
| GET | `/profiles/admin` | Admin | `getAllProfilesAdmin` | Projected paginated admin list. Accepts bounded `search`, `location`, `qualificationStatus`, `sortBy`, and `sortDirection` filters. `approved`/`none` qualification filtering remains compatible with legacy rows that predate `qualificationVerificationStatus`. |
| GET | `/profiles/admin/:id/reviews` | Admin | `getProfileReviewsAdmin` | Safe paginated published-review list for one profile. |
| DELETE | `/profiles/admin/:id` | Admin | `deleteProfile` | Atomically marks the profile as deleting, blocks new lifecycle mutations, transactionally deletes the profile and linked profile-image/qualification-document records, then performs best-effort Cloudinary cleanup with legacy resource-type fallback. The member account remains. |
| PUT | `/profiles/admin/:id` | Admin | `updateProfileQualificationToTrue` | Verify qualifications. |
| GET | `/profile-images` | Auth | `getAllProfileImages` | Current user’s profile images (paginated). |
| GET | `/profile-images-public/:id` | Public | `getAllProfileImagesPublic` | Public profile images (paginated). |

## Email Verification (legacy routes)
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| GET | `/verify?token=...` | Public | `updateConfirmEmail` | Legacy confirm (query token). |
| GET | `/verify/token=:id` | Public | `updateConfirmEmail` | Legacy confirm (path token). |
| GET | `/verifyReviewer?token=...` | Public | `updateConfirmReviewerEmail` | Legacy reviewer confirm. |
| GET | `/verifyReviewer/token=:id` | Public | `updateConfirmReviewerEmail` | Legacy reviewer confirm (path token). |

## Contact Form
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/send` | Public | `sendContactForm` | Sends email via SMTP. |

## Media Uploads
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/userProfileUpload` | Auth | `userProfileImageUpload` | Uploads user avatar (multer). |
| DELETE | `/profile-image/:id` | Auth | `deleteProfileImage` | Deletes profile image by id. |
| POST | `/profileUpload` | Auth | inline | Uploads profile image to Cloudinary. |

## Stripe
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/stripe/webhook` | Public | `stripeWebhookHandler` | Raw body required; signature verified. |
| POST | `/checkout-session` | Public/optional auth | inline checkout handler | Creates hosted Stripe checkout (rate limited). Returns only `{ url }`; does not issue login state before payment succeeds. |
| GET | `/checkout-session/:sessionId` | Public | inline checkout verification handler | Verifies Stripe checkout success session, syncs subscription state, and returns tokenized user payload for post-payment login hydration. |
| POST | `/create-subscription` | Auth | `createSubscription` | Creates subscription for logged-in user. |

## Analytics

| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| GET | `/admin/analytics/overview` | Admin | `getAnalyticsOverview` | Membership, login health/engagement, cumulative onboarding, Stripe revenue, search, and demand/supply overview. Accepts `months` (1–24), `searchDays` (1–365), and `timezone=Europe/London`. Returns cross-source `dataQualityWarnings`; keep these visible in the UI. |
| POST | `/analytics/search-events` | Public | `captureSearchEvent` | Accepts `{ eventId, sessionId, source, receipt }`; verifies the receipt from `GET /profiles`, derives minimized fields, rejects tampering/expiry/empty searches, deduplicates the event and receipt nonce, hashes sessions, stores no raw query/IP, and expires records after 180 days. |

See `ANALYTICS.md` for metric definitions, privacy rules, the intentional Stripe
reconciliation warning, and verification evidence.

## Subscription Enforcement Notes

- Login is authentication only. The frontend should route successful login to `/user-profile-edit`, not `/subscribe`.
- Paid professional-profile actions are enforced by `requireActiveSubscription` middleware.
- `requireActiveSubscription` allows admins, active/trialing Stripe subscriptions, and legacy `pending` only when `isSubscribed === true`.
- It rejects inactive Stripe statuses including `canceled`, `failed`, `incomplete`, `incomplete_expired`, `past_due`, `paused`, and `unpaid`.
- If a paid customer has no `stripeCustomerId` and no `stripeSubscriptionId` in Mongo, login/profile reads cannot reconcile them automatically from Stripe.
