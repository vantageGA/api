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

1. **[BE][Done] Add profile-level verification summary fields**
   Update [profileModel.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/models/profileModel.js) to add `qualificationVerificationStatus` and `qualificationStatusUpdatedAt` while keeping `isQualificationsVerified` for backward compatibility.

2. **[BE] Create the qualification document persistence model**
   Add `models/qualificationDocumentModel.js` with ownership, file metadata, review status, active-submission flags, and indexes for admin queue and user history queries.

3. **[BE] Add request validation for document flows**
   Add `validators/qualificationDocumentValidator.js` for review payloads, route params, and list filters. Keep file-type and file-size enforcement at the upload middleware layer.

4. **[BE] Build dedicated qualification document controller logic**
   Add `controllers/qualificationDocumentController.js` for list, upload, replace, delete, and admin review actions.

5. **[BE] Add dedicated qualification document routes**
   Add `routes/qualificationDocumentRoutes.js` with authenticated user endpoints and admin review endpoints instead of reusing the existing image routes.

6. **[BE] Register the new routes in the server bootstrap**
   Wire the new route module into [server.js](/home/gary/Documents/WebApps/dev/bodyVantage/api/server.js).

7. **[BE] Add document upload middleware for PDF/JPG/PNG**
   Create a dedicated Multer configuration for `application/pdf`, `image/jpeg`, and `image/png`, with a strict `5MB` limit and clear upload errors.

8. **[BE] Add profile-summary sync logic**
   Add helper/service logic so upload, replace, delete, approve, and reject actions always keep `qualificationVerificationStatus` and `isQualificationsVerified` aligned.

9. **[BE] Add audit logging for document lifecycle events**
   Extend `utils/auditLogger.js` usage to log upload, replace, delete, approve, and reject events with actor and target IDs.

10. **[BE] Add rate limiting for qualification-document endpoints**
    Reuse the existing middleware pattern in `middleware/rateLimitMiddleware.js` to reduce upload and review abuse risk.

11. **[FE] Add Redux state for qualification document flows**
    Add constants, actions, and reducers for list, upload, replace, delete, and admin review operations. Keep this separate from the existing profile-image upload state.

12. **[FE] Add the `Qualifications & Documents` section to the profile edit flow**
    Update [ProfileEditView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.jsx#L1046) to keep the rich-text `qualifications` editor and add a separate document-upload area beneath it.

13. **[FE] Build the user upload UI**
    Add a large drag-and-drop target, `Upload Qualification` button, accepted-format copy, max-size copy, and local validation feedback.

14. **[FE] Build the uploaded-files list UI**
    Show file name, upload date, active status badge, and per-file actions for `Replace` and `Delete`.

15. **[FE] Add user-facing status messaging**
    Render the PRD status copy for `Pending`, `Approved`, and `Rejected`, including the rejection reason when available.

16. **[FE] Update the profile summary badge in the edit view**
    Replace the current boolean-only summary in [ProfileEditView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.jsx#L1283) with status-aware messaging while preserving verified styling for approved users.

17. **[FE] Add admin document review controls**
    Extend [AdminProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/adminProfileView/AdminProfileView.jsx#L235) with document status, upload date, and explicit `Approve` / `Reject` actions.

18. **[FE] Add admin rejection-reason capture**
    Add a rejection-reason input or modal so the admin can send actionable feedback such as `Please upload a clearer document`.

19. **[FE] Add admin filtering for pending review work**
    Prioritize pending qualification documents in the admin workflow with status filters and a visible review queue.

20. **[FE] Update public full-profile verification display**
    Update [FullProfileView.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/fullProfile/FullProfileView.jsx#L182) to render approved status from the new summary field while remaining compatible with the boolean fallback.

21. **[FE] Update profile card/search-result badge treatment**
    Update [Card.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/components/card/Card.jsx) so search results can show the verified-professional treatment cleanly after approval.

22. **[BE] Add profile-status backfill/migration support**
    Backfill existing profiles so `isQualificationsVerified=true` maps to `qualificationVerificationStatus='approved'`, and `false` maps to `'none'`.

23. **[BE] Add backend/manual verification scenarios**
    Add API-level manual test coverage for upload, replace, reject, approve, delete, file-type rejection, and authorization checks.

24. **[FE] Add frontend tests for the new UI states**
    Extend the existing Vitest coverage for [ProfileEditView.test.jsx](/home/gary/Documents/WebApps/dev/bodyVantage/client/src/views/profileEditView/ProfileEditView.test.jsx) and add admin-view tests for upload/review state transitions.

25. **[BE] Update backend/docs route references**
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
- `client/src/views/adminProfileView/AdminProfileView.jsx`
- `client/src/views/adminProfileView/AdminProfileView.scss`
- `client/src/store/actions/profileActions.js`
- `client/src/store/reducers/profileReducers.js`
- `client/src/store/constants/profileConstants.js`
- new qualification-document Redux files if you want to keep concerns separated
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
