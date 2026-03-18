# Technical Spec: Qualification Document Upload

## Overview

PRD source: `/home/gary/Documents/WebApps/dev/bodyVantage/prd/BV_UI_Design_Upload_File.pdf`

Feature summary:
- Add a `Qualifications & Documents` section to the profile update/onboarding flow.
- Allow authenticated professionals to upload a qualification document.
- Show file metadata and review status: `Pending`, `Approved`, `Rejected`.
- Allow `Replace` and `Delete` actions.
- Show a verified badge on profile/search surfaces after approval.

This spec maps the PDF to the current BodyVantage backend and frontend implementation.

## Current Stack and Baseline

### Backend

- Express 4 + Mongoose 6 API in [server.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/server.js).
- Profile state is stored in [models/profileModel.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/models/profileModel.js#L94), which currently has:
  - rich-text `qualifications`
  - boolean `isQualificationsVerified`
- Admin verification is a single boolean toggle in [controllers/profileController.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/controllers/profileController.js#L547) exposed by [routes/profileRoutes.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/routes/profileRoutes.js#L43).
- Existing upload flows are image-only Multer + Cloudinary routes in [routes/profileImageRoutes.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/routes/profileImageRoutes.js#L20) and [controllers/imageUploadController.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/controllers/imageUploadController.js).
- Joi validation already exists for profile updates in [validators/profileValidator.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/validators/profileValidator.js).
- Audit logging exists in `utils/auditLogger.js`, but qualification document events are not currently modeled.

### Frontend

- React 18 + Redux Thunk + axios + Vite.
- The profile edit screen in [ProfileEditView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.jsx#L1046) currently supports:
  - rich-text qualifications entry
  - image uploads
  - a summary badge that only shows verified vs not verified
- The admin profile view in [AdminProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/adminProfileView/AdminProfileView.jsx#L235) currently supports:
  - viewing profile rows
  - pressing `Verify`
  - no pending/rejected workflow
  - no document review panel
- Public verification surfaces already exist in:
  - [FullProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/fullProfile/FullProfileView.jsx#L182)
  - [Card.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/components/card/Card.jsx)

### Current Gaps

- No qualification document storage model exists.
- No endpoint accepts `PDF` files.
- No review state other than boolean verified exists.
- No user-visible uploaded file list exists.
- No admin review workflow exists beyond `approve`.
- No backend automated test harness is wired; API `npm test` is still a placeholder.

## Scope Mapping

### In Scope

- One new qualification document upload workflow for authenticated users.
- Status lifecycle: `none -> pending -> approved/rejected`.
- Uploaded file list with filename, upload date, and status badge.
- Replace/delete for the user’s current document submission.
- Admin review queue and review action.
- Verified badge support on profile and search results after approval.

### Non-Goals

- OCR or automatic document validation.
- Public document download URLs.
- Multi-step approval chains.
- Bulk upload of many files in the first release.
- Reworking the existing profile-image upload flow.

## Issues Found

- **High:** Verification is currently write-only to `true`; there is no reject, revoke, or review metadata path in [controllers/profileController.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/controllers/profileController.js#L547).
- **High:** Existing upload routes are image-only and would reject the PDF format required by the PRD in [routes/profileImageRoutes.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/routes/profileImageRoutes.js#L20).
- **Medium:** Public and admin UI surfaces are hard-coded around a boolean badge, not a multi-state review flow in [ProfileEditView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.jsx#L1283) and [AdminProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/adminProfileView/AdminProfileView.jsx#L235).
- **Medium:** Sensitive qualification files should not be exposed using the same public image pattern as current Cloudinary image uploads.
- **Medium:** There is no API test coverage for this feature area today.

## Architecture and Design

### Recommended Model

Use a dedicated `QualificationDocument` collection instead of embedding file metadata directly into `Profile`.

Rationale:
- Qualification files are operational data, not core public profile data.
- Admin review and user listing queries benefit from dedicated indexes.
- Public profile reads should not carry document metadata by default.
- This keeps the existing `Profile` document lightweight and backward compatible.

### Verification State Model

Retain `profile.isQualificationsVerified` for backward compatibility and add a new summary field:

- `qualificationVerificationStatus: 'none' | 'pending' | 'approved' | 'rejected'`

Rules:
- On first upload: set status to `pending`, set `isQualificationsVerified=false`
- On replace: set status to `pending`, set `isQualificationsVerified=false`
- On admin approval: set status to `approved`, set `isQualificationsVerified=true`
- On admin rejection: set status to `rejected`, set `isQualificationsVerified=false`
- On delete of the active submission: set status to `none`, set `isQualificationsVerified=false`

### File Handling

Use a new upload path and do not reuse the image upload route.

Requirements:
- Accept `application/pdf`, `image/jpeg`, `image/png`
- Enforce max size `5MB`
- Store documents in Cloudinary under a dedicated folder, for example `qualificationDocuments`
- Store only metadata in MongoDB
- Do not expose direct public URLs on public profile payloads

Security recommendation:
- Treat qualification assets as private/internal review assets
- If document preview/download is added, serve time-limited signed URLs only to the owner or admins

## API Contract

### User Endpoints

#### `GET /api/profile/qualification-documents`

Auth: required

Response:

```json
{
  "documents": [
    {
      "_id": "docId",
      "originalFileName": "pt-certificate.pdf",
      "mimeType": "application/pdf",
      "fileSizeBytes": 302114,
      "uploadedAt": "2026-03-18T10:00:00.000Z",
      "status": "pending",
      "reviewedAt": null,
      "rejectionReason": ""
    }
  ],
  "activeDocumentId": "docId",
  "profileStatus": "pending"
}
```

#### `POST /api/profile/qualification-documents`

Auth: required

Content type: `multipart/form-data`

Form field:
- `qualificationDocument`

Behavior:
- Upload new document
- Mark prior active submission as superseded
- Reset profile verification state to pending

Error cases:
- `400` invalid file type
- `400` file too large
- `404` profile not found

#### `PUT /api/profile/qualification-documents/:id`

Auth: required

Content type: `multipart/form-data`

Behavior:
- Replace an existing user-owned submission
- Equivalent to upload-new + supersede-old in one transaction-like flow

#### `DELETE /api/profile/qualification-documents/:id`

Auth: required

Behavior:
- Delete a user-owned submission
- If the deleted document is the active submission, recalculate profile summary state

### Admin Endpoints

#### `GET /api/profiles/admin/qualification-documents`

Auth: admin

Query params:
- `status`
- `page`
- `limit`

Purpose:
- review queue and filtering

#### `PATCH /api/profiles/admin/qualification-documents/:id/review`

Auth: admin

Request body:

```json
{
  "status": "approved"
}
```

or

```json
{
  "status": "rejected",
  "rejectionReason": "Please upload a clearer document"
}
```

Behavior:
- Update document review state
- Stamp `reviewedAt` and `reviewedBy`
- Sync `Profile` summary fields
- Emit audit log event

## Data Model and Persistence

### Profile Changes

Update [models/profileModel.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/models/profileModel.js) with:

- `qualificationVerificationStatus`
- optional `qualificationStatusUpdatedAt`

Backward compatibility:
- Keep `isQualificationsVerified`
- Existing public/client consumers continue working while UI migrates to the richer status

### New Collection: `QualificationDocument`

Recommended schema:

```js
{
  user: ObjectId,
  profile: ObjectId,
  originalFileName: String,
  mimeType: String,
  fileSizeBytes: Number,
  cloudinaryPublicId: String,
  cloudinaryResourceType: String,
  status: 'pending' | 'approved' | 'rejected',
  rejectionReason: String,
  reviewedAt: Date,
  reviewedBy: ObjectId,
  isActive: Boolean,
  supersededAt: Date
}
```

Recommended indexes:
- `{ profile: 1, isActive: 1 }`
- `{ user: 1, createdAt: -1 }`
- `{ status: 1, createdAt: -1 }`
- `{ reviewedBy: 1, reviewedAt: -1 }`

### Migration

Backfill existing profiles:
- `isQualificationsVerified=true` -> `qualificationVerificationStatus='approved'`
- `isQualificationsVerified=false` -> `qualificationVerificationStatus='none'`

No historical document backfill is required.

## Security and Compliance

- Validate ownership on all user document routes.
- Restrict review endpoints to `admin`.
- Add upload rate limiting to reduce abuse.
- Reject unsupported MIME types and oversized files server-side, even if client validation exists.
- Avoid public document URLs.
- Log upload, replace, delete, approve, and reject events with user/admin IDs.
- Redact filenames or document IDs where needed in generic error payloads.

## Implementation Plan

### Numbered Task Breakdown

### Completed Work

- **Task 1 completed on 2026-03-18**
  Summary:
  Added `qualificationVerificationStatus` and `qualificationStatusUpdatedAt` to the `Profile` schema, defaulted new profiles to `none`, updated the existing admin verify flow to stamp `approved` plus a timestamp, and marked the new fields as protected/system-managed.

- **Task 2 completed on 2026-03-18**
  Summary:
  Added `models/qualificationDocumentModel.js` with `user` and `profile` ownership references, qualification file metadata, review-state fields, active/superseded lifecycle fields, and indexes for active profile lookups, user history, and admin review queues.

- **Task 3 completed on 2026-03-18**
  Summary:
  Added `validators/qualificationDocumentValidator.js` with Joi schemas for qualification document route params, paginated list filters, and admin review payloads, including validation rules for approved vs rejected review states and rejection-reason requirements.

- **Task 4 completed on 2026-03-18**
  Summary:
  Added `controllers/qualificationDocumentController.js` with dedicated controller actions for owner list/upload/replace/delete flows and admin list/review flows, including Cloudinary upload/delete handling, active-document superseding, and profile qualification-status syncing inside the controller.

- **Task 5 completed on 2026-03-18**
  Summary:
  Added `routes/qualificationDocumentRoutes.js` with dedicated authenticated user and admin route definitions for qualification document list/upload/replace/delete/review flows, wired to the new controller actions and Joi validators.

- **Task 6 completed on 2026-03-18**
  Summary:
  Registered `qualificationDocumentRoutes` in `server.js` under `/api` and mounted it before `profileRoutes` so `/api/profile/qualification-documents` is not incorrectly matched by the existing `/api/profile/:id` route. Updated route documentation in `AGENTS.md` and `docs/ROUTES.md`.

- **Task 7 completed on 2026-03-18**
  Summary:
  Added `middleware/qualificationDocumentUploadMiddleware.js` using Multer memory storage with a single-file `qualificationDocument` field, `PDF/JPG/PNG` MIME filtering, and a strict `5MB` limit with clear upload error messages. Wired the middleware into the qualification document `POST` and `PUT` routes and shared the upload validation constants with the controller.

- **Task 8 completed on 2026-03-18**
  Summary:
  Moved profile qualification-summary sync into `utils/profileHelpers.js` via shared helper functions for direct status updates and active-document reconciliation. Updated both `qualificationDocumentController.js` and the legacy admin verify path in `profileController.js` to use the shared helper logic instead of controller-local status writes.

- **Task 9 completed on 2026-03-18**
  Summary:
  Extended `utils/auditLogger.js` with qualification-document lifecycle event types and added structured audit logging in `qualificationDocumentController.js` for upload, replace, delete, approve, and reject actions. Each log entry now includes the actor, target user, profile, and document identifiers plus the resulting profile/document status context.

- **Task 10 completed on 2026-03-18**
  Summary:
  Added dedicated qualification-document rate limiters in `middleware/rateLimitMiddleware.js` and applied them in `routes/qualificationDocumentRoutes.js`. Authenticated user mutation endpoints (`POST|PUT|DELETE`) are now limited to `10 requests / 15 minutes` per user, and the admin review endpoint (`PATCH`) is limited to `60 requests / 15 minutes` per admin, with `RATE_LIMIT_EXCEEDED` audit entries written when triggered.

- **Task 22 completed on 2026-03-18**
  Summary:
  Added `scripts/backfillQualificationVerificationStatus.js` to backfill legacy profile verification state into the new summary fields. The migration maps `isQualificationsVerified=true` to `qualificationVerificationStatus='approved'` and `false` to `'none'` for profiles with missing/invalid status values, sets `qualificationStatusUpdatedAt`, and runs transactionally so it is safe to rerun.

- **Task 23 completed on 2026-03-18**
  Summary:
  Added backend manual verification coverage for qualification document flows in `docs/QUALIFICATION_DOCUMENT_MANUAL_TESTS.md`, including API-level scenarios for upload, replace, reject, approve, delete, file-type rejection, oversize-file rejection, and authorization checks (unauthenticated, non-owner, non-admin).

- **Task 25 completed on 2026-03-18**
  Summary:
  Updated backend route and operations documentation to align with the qualification-document route set and storage behavior. `docs/ROUTES.md` now includes Cloudinary storage-type notes for PDF vs JPG/PNG on upload/replace, `AGENTS.md` route references now include onboarding tutorial patch and qualification route troubleshooting details, and `docs/ENV_CONFIGURATION.md` now documents Cloudinary requirements for qualification-document uploads.

- **Task 11 completed on 2026-03-18**
  Summary:
  Added dedicated frontend Redux state for qualification document list, upload, replace, delete, admin list, and admin review flows via `qualificationDocumentConstants.js`, `qualificationDocumentActions.js`, and `qualificationDocumentReducers.js`. Wired the new slices into `store.js`, kept the document flow separate from the existing profile-image state, and added reducer coverage in `qualificationDocumentReducers.test.js`.

- **Task 12 completed on 2026-03-18**
  Summary:
  Updated `ProfileEditView.jsx` to rename the accordion section to `Qualifications & Documents`, retain the existing rich-text qualifications editor, and add a dedicated qualification-document area beneath it. Wired the view to `qualificationDocuments` Redux state for current document metadata/status, added matching styles in `ProfileEditView.scss`, and added view coverage in `ProfileEditView.test.jsx`.

- **Task 13 completed on 2026-03-18**
  Summary:
  Built the user upload UI inside `ProfileEditView.jsx` with a large drag-and-drop target, hidden file input triggered by a browse button, selected-file summary, `Upload Qualification` action, and client-side PDF/JPG/PNG plus `5MB` validation feedback. Added supporting upload-area styles in `ProfileEditView.scss` and test coverage for valid upload dispatch plus invalid-file feedback in `ProfileEditView.test.jsx`.

- **Task 14 completed on 2026-03-18**
  Summary:
  Added an uploaded-files list to `ProfileEditView.jsx` showing each qualification document with filename, upload date, active/submitted badge state, and review-status badge treatment. Wired per-file `Replace` and `Delete` actions to the existing Redux flows, added supporting list/card styles in `ProfileEditView.scss`, and extended `ProfileEditView.test.jsx` coverage for list rendering plus replace/delete dispatch behavior.

- **Task 15 completed on 2026-03-18**
  Summary:
  Added user-facing qualification status messaging in `ProfileEditView.jsx` for `Pending`, `Approved`, `Rejected`, and the default not-submitted state, including rejection-reason copy when available. Kept the messaging aligned with the existing section design using dedicated status-message styles in `ProfileEditView.scss`, and added Vitest coverage in `ProfileEditView.test.jsx` for pending, rejected, and approved state rendering.

- **Task 16 completed on 2026-03-18**
  Summary:
  Updated the qualification summary block in `ProfileEditView.jsx` to use the new status model instead of the old boolean-only `isQualificationsVerified` branch. The summary now shows `Not Submitted`, `Pending Review`, `Rejected`, or a preserved `Verified` treatment for approved users, with supporting status detail copy and matching style updates in `ProfileEditView.scss`, plus Vitest coverage in `ProfileEditView.test.jsx`.

- **Task 17 completed on 2026-03-18**
  Summary:
  Extended `AdminProfileView.jsx` with a dedicated active qualification-document review panel that shows document status, upload date, profile context, and explicit `Approve` / `Reject` controls. Updated the admin status badges to use the new qualification status model, added matching layout/status styles in `AdminProfileView.scss`, added focused coverage in `AdminProfileView.test.jsx`, and updated `qualificationDocumentActions.js` so review refreshes preserve the current admin profile page. Rejections currently send a default reason until task 18 adds custom capture.

- **Task 18 completed on 2026-03-18**
  Summary:
  Added admin rejection-reason capture in `AdminProfileView.jsx` with an inline rejection editor, reason length validation aligned to backend requirements, character counting, and explicit submit/cancel controls. Reject actions now require admin-entered feedback instead of using a hardcoded default reason, while preserving existing approve/reject review flow state handling. Added supporting editor styles in `AdminProfileView.scss` and updated `AdminProfileView.test.jsx` coverage for reject validation and dispatch payloads.

- **Task 19 completed on 2026-03-18**
  Summary:
  Prioritized pending qualification documents in `AdminProfileView.jsx` by default via a `pending` status filter, added visible status-filter controls (`Pending`, `Approved`, `Rejected`, `All`) for the admin review queue, and wired filter state into admin document fetch/refresh behavior. Review actions now preserve the active queue filter context after approve/reject, and the queue list keeps pending items prioritized when mixed statuses are shown. Added supporting filter styles in `AdminProfileView.scss` and extended `AdminProfileView.test.jsx` coverage for filter-triggered refetch and filtered review payload refresh options.

- **Task 20 completed on 2026-03-18**
  Summary:
  Updated `FullProfileView.jsx` to resolve qualification verification display from the new `qualificationVerificationStatus` summary field (`approved` => verified treatment) while retaining `isQualificationsVerified` as a fallback for legacy payloads. Added explicit public status text (`Verified`, `Pending review`, `Not verified`) and moved status-icon styling into `FullProfileView.scss` so the view remains consistent with existing styling patterns without inline icon styles.

- **Task 21 completed on 2026-03-18**
  Summary:
  Updated `Card.jsx` and `HomeView.jsx` so profile/search cards receive and use `qualificationVerificationStatus` with `isQualificationsVerified` as a legacy fallback, and show a clean `Verified Professional` badge only when the effective status is approved. Added matching badge styling in `Card.scss` and focused coverage in `Card.test.jsx` for approved, pending, and fallback behaviors.

- **Task 24 completed on 2026-03-18**
  Summary:
  Extended frontend Vitest coverage for qualification-document UI states in `ProfileEditView.test.jsx` and `AdminProfileView.test.jsx`. Added profile-edit tests for qualification document loading/error surfaces and upload/replace/delete mutation result notifications with reset dispatch assertions, plus admin tests for review-queue empty-state and review success/error message rendering.

1. **[BE][Done] Add profile-level verification summary fields**
   Update [profileModel.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/models/profileModel.js) to add `qualificationVerificationStatus` and `qualificationStatusUpdatedAt` while keeping `isQualificationsVerified` for backward compatibility.

2. **[BE][Done] Create the qualification document persistence model**
   Add `models/qualificationDocumentModel.js` with ownership, file metadata, review status, active-submission flags, and indexes for admin queue and user history queries.

3. **[BE][Done] Add request validation for document flows**
   Add `validators/qualificationDocumentValidator.js` for review payloads, route params, and list filters. Keep file-type and file-size enforcement at the upload middleware layer.

4. **[BE][Done] Build dedicated qualification document controller logic**
   Add `controllers/qualificationDocumentController.js` for list, upload, replace, delete, and admin review actions.

5. **[BE][Done] Add dedicated qualification document routes**
   Add `routes/qualificationDocumentRoutes.js` with authenticated user endpoints and admin review endpoints instead of reusing the existing image routes.

6. **[BE][Done] Register the new routes in the server bootstrap**
   Wire the new route module into [server.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/server.js).

7. **[BE][Done] Add document upload middleware for PDF/JPG/PNG**
   Create a dedicated Multer configuration for `application/pdf`, `image/jpeg`, and `image/png`, with a strict `5MB` limit and clear upload errors.

8. **[BE][Done] Add profile-summary sync logic**
   Add helper/service logic so upload, replace, delete, approve, and reject actions always keep `qualificationVerificationStatus` and `isQualificationsVerified` aligned.

9. **[BE][Done] Add audit logging for document lifecycle events**
   Extend `utils/auditLogger.js` usage to log upload, replace, delete, approve, and reject events with actor and target IDs.

10. **[BE][Done] Add rate limiting for qualification-document endpoints**
   Reuse the existing middleware pattern in `middleware/rateLimitMiddleware.js` to reduce upload and review abuse risk.

11. **[FE][Done] Add Redux state for qualification document flows**
    Add constants, actions, and reducers for list, upload, replace, delete, and admin review operations. Keep this separate from the existing profile-image upload state.

12. **[FE][Done] Add the `Qualifications & Documents` section to the profile edit flow**
    Update [ProfileEditView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.jsx#L1046) to keep the rich-text `qualifications` editor and add a separate document-upload area beneath it.

13. **[FE][Done] Build the user upload UI**
    Add a large drag-and-drop target, `Upload Qualification` button, accepted-format copy, max-size copy, and local validation feedback.

14. **[FE][Done] Build the uploaded-files list UI**
    Show file name, upload date, active status badge, and per-file actions for `Replace` and `Delete`.

15. **[FE][Done] Add user-facing status messaging**
    Render the PRD status copy for `Pending`, `Approved`, and `Rejected`, including the rejection reason when available.

16. **[FE][Done] Update the profile summary badge in the edit view**
    Replace the current boolean-only summary in [ProfileEditView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.jsx#L1283) with status-aware messaging while preserving verified styling for approved users.

17. **[FE][Done] Add admin document review controls**
    Extend [AdminProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/adminProfileView/AdminProfileView.jsx#L235) with document status, upload date, and explicit `Approve` / `Reject` actions.

18. **[FE][Done] Add admin rejection-reason capture**
    Add a rejection-reason input or modal so the admin can send actionable feedback such as `Please upload a clearer document`.

19. **[FE][Done] Add admin filtering for pending review work**
    Prioritize pending qualification documents in the admin workflow with status filters and a visible review queue.

20. **[FE][Done] Update public full-profile verification display**
    Update [FullProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/fullProfile/FullProfileView.jsx#L182) to render approved status from the new summary field while remaining compatible with the boolean fallback.

21. **[FE][Done] Update profile card/search-result badge treatment**
    Update [Card.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/components/card/Card.jsx) so search results can show the verified-professional treatment cleanly after approval.

22. **[BE][Done] Add profile-status backfill/migration support**
    Backfill existing profiles so `isQualificationsVerified=true` maps to `qualificationVerificationStatus='approved'`, and `false` maps to `'none'`.

23. **[BE][Done] Add backend/manual verification scenarios**
    Add API-level manual test coverage for upload, replace, reject, approve, delete, file-type rejection, and authorization checks.

24. **[FE][Done] Add frontend tests for the new UI states**
    Extend the existing Vitest coverage for [ProfileEditView.test.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.test.jsx) and add admin-view tests for upload/review state transitions.

25. **[BE][Done] Update backend/docs route references**
    Update `docs/ROUTES.md`, `AGENTS.md`, and any environment notes required by the new qualification-document route set and storage behavior.

## Suggested File Touchpoints

### Backend

- `models/profileModel.js`
- `models/qualificationDocumentModel.js`
- `controllers/profileController.js`
- `controllers/qualificationDocumentController.js`
- `routes/profileRoutes.js`
- `routes/qualificationDocumentRoutes.js`
- `validators/profileValidator.js`
- `validators/qualificationDocumentValidator.js`
- `middleware/rateLimitMiddleware.js`
- `utils/auditLogger.js`
- `server.js`

### Frontend

- `client/src/views/profileEditView/ProfileEditView.jsx`
- `client/src/views/profileEditView/ProfileEditView.scss`
- `client/src/views/profileEditView/ProfileEditView.test.jsx`
- `client/src/views/adminProfileView/AdminProfileView.jsx`
- `client/src/views/adminProfileView/AdminProfileView.scss`
- `client/src/store/store.js`
- `client/src/store/constants/qualificationDocumentConstants.js`
- `client/src/store/actions/qualificationDocumentActions.js`
- `client/src/store/reducers/qualificationDocumentReducers.js`
- `client/src/store/reducers/qualificationDocumentReducers.test.js`
- `client/src/views/fullProfile/FullProfileView.jsx`
- `client/src/components/card/Card.jsx`

## Testing Plan

### Backend

- Validate accepted types: PDF, JPG, PNG
- Reject unsupported types and files over `5MB`
- User can list only their own documents
- User cannot replace/delete another user’s document
- Admin can review only existing documents
- Approval updates both document state and profile summary state
- Rejection updates both document state and profile summary state
- Delete updates active profile state correctly
- Audit log entries are written for upload/review/delete

### Frontend

- `ProfileEditView` renders upload UI and status badges
- Drag/drop and file input both dispatch upload flow
- Replace/delete buttons call the correct Redux actions
- Admin review view updates status in-place after approve/reject
- Public profile/search surfaces show the verified badge only after approval

### Manual Regression

- Existing profile rich-text qualifications still save correctly
- Existing profile image upload still works unchanged
- Existing admin profile list still paginates and sorts
- Existing public profile rendering still works when no document exists

## Rollout and Operations

- Deploy backend model and route changes first.
- Run the profile-status backfill script.
- Deploy frontend UI after API is live.
- Monitor for:
  - upload failures
  - Cloudinary errors
  - admin review errors
  - unexpected growth in document storage
- Rollback path:
  - disable new UI
  - keep `isQualificationsVerified` compatibility
  - leave uploaded documents in storage if rollback is UI/API-only

## Risks and Open Questions

- The PDF implies plural file support, but the current domain model is closer to one active verification document with history. This spec assumes one active submission at a time.
- If the business requires multiple active supporting documents per profile, the admin review workflow and profile summary rules need one more decision.
- Cloudinary document privacy needs explicit implementation rules before shipping.
- There is no backend test harness today, so initial confidence will depend heavily on manual testing unless test infrastructure is added in the same workstream.

## Decision Log

| Decision | Choice | Reason |
| --- | --- | --- |
| Storage model | Separate `QualificationDocument` collection | Better queryability, less public profile bloat |
| Verification summary | Keep boolean + add status enum | Backward compatibility for current UI |
| Upload model | Dedicated document endpoint | Existing upload routes are image-specific |
| MVP scope | One active submission with history | Simplest fit for current boolean verification model |

## Technical Acceptance Criteria

- [ ] Users can upload a `PDF`, `JPG`, or `PNG` document up to `5MB`
- [ ] The profile edit UI shows file name, upload date, and review status
- [ ] Users can replace and delete their own active submission
- [ ] Admins can approve or reject a submission
- [ ] Approval sets `qualificationVerificationStatus='approved'` and `isQualificationsVerified=true`
- [ ] Rejection sets `qualificationVerificationStatus='rejected'` and `isQualificationsVerified=false`
- [ ] Public badge surfaces only show verified treatment for approved profiles
- [ ] Unsupported files and oversize uploads are rejected server-side
- [ ] Document routes enforce authz correctly
- [ ] Audit log events are written for key state changes
