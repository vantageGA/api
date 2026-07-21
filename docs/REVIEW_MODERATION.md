# Review moderation

New reviews are screened and stored as `pending_review` or
`under_moderation`. They are excluded from public profile responses, ratings,
and review totals until an administrator publishes them.

## Administrative endpoints

- `GET /api/profiles/admin/reviews` lists the paginated queue. It accepts
  `page`, `limit`, `status`, `riskLevel`, and `search`.
- `PATCH /api/profiles/admin/:profileId/reviews/:reviewId/moderate` accepts
  `approve`, `reject`, `request_amendment`, or `remove` plus a reason where
  required.
- `POST /api/profiles/admin/reviews/bulk-approve` approves up to 100 low-risk
  reviews and returns a result for every requested review. A `207` response
  means that only part of the batch succeeded.
- The legacy `DELETE /api/profiles/:id/reviews` route now performs an audited
  removal and requires `{ reviewId, reason }`; it no longer deletes review data.

Moderation mutations use a conditional embedded-document update. If the
review status changes between reading and writing, the API returns `409`
instead of overwriting the newer decision.

## Reviewer endpoints

- `GET /api/reviewers/me/reviews` lists reviews owned by the authenticated
  reviewer.
- `PATCH /api/profiles/:profileId/reviews/:reviewId/amend` resubmits a review
  only when its status is `amendment_requested` and ownership matches the
  reviewer token.

## Public compatibility

Reviews created before moderation have no status and remain public. New
reviews are public only when their status is `published`. Removed and rejected
reviews remain stored for audit purposes but are excluded from public output.
