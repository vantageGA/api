# Qualification Document Manual Verification (Backend)

Manual API scenarios for qualification document workflows.

## Prerequisites

- Backend running locally: `npm run server`
- At least three accounts:
  - `USER_A` (owns a profile)
  - `USER_B` (owns a different profile)
  - `ADMIN` (admin privileges)
- Bearer tokens for each account:
  - `USER_A_TOKEN`
  - `USER_B_TOKEN`
  - `ADMIN_TOKEN`
- Test files:
  - `valid.pdf` (<= 5MB)
  - `valid.jpg` (<= 5MB)
  - `invalid.txt`
  - `oversize.pdf` (> 5MB)

Set environment variables before running samples:

```bash
export API_BASE="http://localhost:5000/api"
export USER_A_TOKEN="..."
export USER_B_TOKEN="..."
export ADMIN_TOKEN="..."
```

## 1) Upload (happy path)

```bash
curl -i -X POST "$API_BASE/profile/qualification-documents" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -F "qualificationDocument=@./valid.pdf"
```

Expected:
- `201`
- Response contains `document.status = "pending"`
- Response contains `profileStatus = "pending"`

## 2) Replace active submission

Use the first upload response `document._id` as `DOC_ID`.

```bash
curl -i -X PUT "$API_BASE/profile/qualification-documents/$DOC_ID" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -F "qualificationDocument=@./valid.jpg"
```

Expected:
- `200`
- Response includes `replacedDocumentId` matching `DOC_ID`
- New `document.status = "pending"`

## 3) Reject (admin review)

Use current active document id as `ACTIVE_DOC_ID`.

```bash
curl -i -X PATCH "$API_BASE/profiles/admin/qualification-documents/$ACTIVE_DOC_ID/review" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"rejected","rejectionReason":"Please upload a clearer document scan."}'
```

Expected:
- `200`
- Response `document.status = "rejected"`
- Response `profileStatus = "rejected"`

## 4) Approve (admin review)

Upload/replace again so there is an active pending submission, then:

```bash
curl -i -X PATCH "$API_BASE/profiles/admin/qualification-documents/$ACTIVE_DOC_ID/review" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'
```

Expected:
- `200`
- Response `document.status = "approved"`
- Response `profileStatus = "approved"`

## 5) Delete (owner)

```bash
curl -i -X DELETE "$API_BASE/profile/qualification-documents/$ACTIVE_DOC_ID" \
  -H "Authorization: Bearer $USER_A_TOKEN"
```

Expected:
- `200`
- Response includes `deletedDocumentId`
- Profile status reconciles based on remaining active docs (or `none`)

## 6) File-type rejection

```bash
curl -i -X POST "$API_BASE/profile/qualification-documents" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -F "qualificationDocument=@./invalid.txt"
```

Expected:
- `400`
- Error indicates only `PDF/JPG/PNG` are allowed

## 7) Oversize rejection

```bash
curl -i -X POST "$API_BASE/profile/qualification-documents" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -F "qualificationDocument=@./oversize.pdf"
```

Expected:
- `400`
- Error indicates `5MB` max size

## 8) Authorization checks

Unauthenticated upload:

```bash
curl -i -X POST "$API_BASE/profile/qualification-documents" \
  -F "qualificationDocument=@./valid.pdf"
```

Expected:
- `401`

User cannot delete another user document:

```bash
curl -i -X DELETE "$API_BASE/profile/qualification-documents/$ACTIVE_DOC_ID" \
  -H "Authorization: Bearer $USER_B_TOKEN"
```

Expected:
- `404` (not found for that owner scope)

Non-admin cannot review:

```bash
curl -i -X PATCH "$API_BASE/profiles/admin/qualification-documents/$ACTIVE_DOC_ID/review" \
  -H "Authorization: Bearer $USER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'
```

Expected:
- `401` or `403` (admin-only path)

## 9) Optional audit verification

After running scenarios, inspect `logs/audit.log` and confirm lifecycle events:
- `QUALIFICATION_DOCUMENT_UPLOADED`
- `QUALIFICATION_DOCUMENT_REPLACED`
- `QUALIFICATION_DOCUMENT_DELETED`
- `QUALIFICATION_DOCUMENT_APPROVED`
- `QUALIFICATION_DOCUMENT_REJECTED`
- `RATE_LIMIT_EXCEEDED` (when limit tests are run)
