# Routes Index

All routes are mounted under `/api` in `server.js` unless noted.

## Auth & Users
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/users/login` | Public | `authUser` | Login (rate limited). |
| POST | `/users` | Public | `registerUser` | Registration (rate limited). |
| GET | `/users` | Admin | `getAllUsersProfile` | List all users. |
| GET | `/users/profile` | Auth | `getUserProfile` | Current user profile. |
| PUT | `/users/profile` | Auth | `updateUserProfile` | Update current user (email change requires verification). |
| GET | `/user/profile/:id` | Public | `getUserProfileById` | Public user profile. |
| GET | `/users/:id` | Admin | `getUserProfileById` | Admin view of user by id. |
| DELETE | `/users/:id` | Admin | `deleteUser` | Deletes user and related data (Cloudinary cleanup). |
| PUT | `/user/profile/:id` | Admin | `updateIsAdmin` | Toggle admin (boolean body). |
| POST | `/user-forgot-password` | Public | `userForgotPassword` | Password reset request (rate limited). |
| PUT | `/user-update-password` | Public | `updateUserProfilePassword` | Reset password with token. |
| GET | `/verify` | Public | `verifyEmail` | Email verification (token query). |
| GET | `/verify-email-change` | Public | `verifyEmailChange` | Email change verification (token query). |

## Reviewer Accounts
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| POST | `/users-review/login` | Public | `authUserReview` | Reviewer login. |
| POST | `/users-review` | Public | `registerUserReviewer` | Reviewer registration. |
| GET | `/reviewers/admin` | Admin | `getAllUsersReviews` | List reviewers. |
| GET | `/reviewer/public/:id` | Public | `getAllUsersReviewers` | Public reviewer profile by id. |
| DELETE | `/reviewer/admin/:id` | Admin | `deleteReviewer` | Delete reviewer. |
| POST | `/reviewer-forgot-password` | Public | `reviewerForgotPassword` | Reviewer reset request. |
| PUT | `/reviewer-update-password` | Public | `updateReviewerPassword` | Reviewer reset confirm. |

## Profiles
| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| GET | `/profiles` | Public | `getAllProfiles` | Pagination + search (`search`, `page`, `limit`). |
| POST | `/profiles` | Auth | `createProfile` | Create profile. |
| GET | `/profiles/:id` | Public | `getProfileById` | Profile by id. |
| GET | `/profile/:id` | Public | `getProfileById` | Backward compatible alias. |
| GET | `/profile` | Auth | `getProfile` | Current user's profile. |
| PUT | `/profile` | Auth | `updateProfile` | Update current user's profile (blocked with `403 ONBOARDING_TUTORIAL_REQUIRED` when onboarding is incomplete and enforcement is enabled). |
| PATCH | `/profile/onboarding-tutorial` | Auth | `updateOnboardingTutorialStatus` | Update onboarding tutorial interaction/completion state for current user. |
| PUT | `/profile-clicks` | Public | `updateProfileClicks` | Increments click counter (by id in body). |
| POST | `/profiles/:id/reviews` | Auth | `createProfileReview` | Reviewer creates review (rate limited). |
| DELETE | `/profiles/:id/reviews` | Admin | `deleteReview` | Delete review (reviewId in body). |
| GET | `/profiles/admin` | Admin | `getAllProfilesAdmin` | Admin list, paginated. |
| DELETE | `/profiles/admin/:id` | Admin | `deleteProfile` | Delete profile. |
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
| POST | `/checkout-session` | Public | `createCheckoutSession` | Creates hosted checkout (rate limited). |
| POST | `/create-subscription` | Auth | `createSubscription` | Creates subscription for logged-in user. |
