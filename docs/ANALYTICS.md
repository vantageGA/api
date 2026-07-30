# Phase 1 Analytics API

Status: Implemented and test-verified on 2026-07-29.

## Routes

### `GET /api/admin/analytics/overview`

Requires a member JWT and `isAdmin: true`.

Validated query parameters:

- `months`: integer from 1–24; default `12`.
- `searchDays`: integer from 1–365; default `30`.
- `timezone`: currently only `Europe/London`.

The response contains:

- top-level `generatedAt`, `asOf`, and `timezone` provenance;
- `membership`: current non-admin registration, paid-access, verification,
  disabled-profile, expiry, calendar registration, and cumulative growth data.
- `engagement`: successful member-login sessions, distinct members, recent
  paid-member activity/inactivity, a monthly login trend, and capped
  member-level active/attention lists. It also contains transparent
  login-recency health segments.
- `onboarding`: a seven-stage cumulative current-state funnel from registration
  through approved qualifications.
- `revenue`: Stripe invoice totals grouped by currency, outstanding balances,
  subscription counts, and renewals due in 30 days.
- `search`: settled-search totals, no-result count, top dimensions, and
  profession/location demand compared with discoverable profile supply.
- `dataQualityWarnings`: cross-source reconciliation warnings that must remain
  visible in the admin UI.

The membership and search panels still return if Stripe is unavailable.

### Member login measurement

A successful `POST /api/users/login` for a non-admin member schedules one
`LoginEvent` and advances the User's minimal `lastSuccessfulLoginAt` timestamp.
Admin and reviewer logins are excluded. Capture is detached from the response,
so a slow or failed analytics write cannot delay or fail authentication.

The event contains only:

- the member's MongoDB `_id`;
- `accountType=member`;
- `occurredAt`;
- `expiresAt`.

It does not store email, name, IP address, user agent, password data, token, or
Stripe identifiers. MongoDB removes events through a TTL index after 400 days.
The durable User timestamp prevents long-inactive measured members becoming
`Not yet measured` after detailed events expire. Deleting a User removes their
linked LoginEvents inside the account-deletion transaction.

### `POST /api/analytics/search-events`

Public, validation-protected, and limited to 60 requests per 15 minutes per IP.
A non-empty page-one `GET /api/profiles` response contains a five-minute
`analyticsReceipt` signed with the server secret. It binds normalized criteria,
the server-calculated total, page one, source, issue/expiry times, and a random
nonce.
Empty and later-page requests return `analyticsReceipt: null`.

After criteria settle, the client submits only `eventId`, `sessionId`, `source`,
and the receipt. The API rejects tampered, expired, empty, or source-mismatched
receipts and deduplicates the event ID and one-time receipt nonce.

Stored fields are derived from the verified receipt. Full raw query text is not
stored; email, URL, and telephone-like fragments are removed before bounded
keyword tokens are retained. The anonymous session value is SHA-256 hashed,
IP addresses are not stored, and a TTL index removes records after 180 days.

## Metric Contracts

- Registered members: current non-admin users, confirmed or unconfirmed.
- Active paid members: confirmed non-admin users with `isSubscribed: true`, an
  allowed payment status, and no expired `currentPeriodEnd`.
- Pending verification: profiles whose qualification summary is `pending` and
  whose current owner is not an administrator.
- Disabled public profiles: non-admin users with
  `publicProfileStatus: disabled`.
- Revenue: gross `amount_paid` from paid Stripe invoices, calendar
  month-to-date and year-to-date, in integer minor units grouped by currency.
- Outstanding: `amount_remaining` from open Stripe invoices.
- Renewals: active/trialing subscriptions ending in the next 30 days, excluding
  `cancel_at_period_end`.
- Unique member logins: distinct non-admin member IDs with a successful login
  in the Europe/London calendar day, week, or month.
- Login sessions: successful non-admin member login events in the same calendar
  windows. Repeat logins count as sessions but not additional unique members.
- Active paid seen in 30 days: current active paid members with at least one
  successful login in the rolling 30 days ending at `asOf`.
- Paid inactive 30+ days: current active paid members with no successful login
  in that rolling window. This includes members whose last login predates event
  capture, so the completeness note must remain visible during rollout.
- Monthly login trend: sessions and distinct member IDs per Europe/London
  calendar month for the requested `months` window.
- Most active paid members: up to ten current active paid members with a login
  in the rolling 30-day window, ordered by session count and then most recent
  login. Each row returns `memberId`, `name`, `email`, `sessions30Days`, and
  `lastLoginAt`.
- Members needing attention: up to ten current active paid members without a
  login in that rolling window. Members never seen by the event system sort
  first, followed by the oldest retained login. Each row returns `memberId`,
  `name`, `email`, and nullable `lastLoginAt`; the
  `activePaidInactive30Days` KPI remains the uncapped total.
- Member health cohort: current active paid members only.
- Healthy: last captured successful login within 7 days.
- Occasional: last login 8–30 days ago.
- Slipping: last login 31–60 days ago.
- At risk: a captured last login more than 60 days ago.
- Not yet measured: no event captured since login measurement began. This is
  deliberately separate from `At risk`.
- Health coverage: measured active-paid members divided by the current
  active-paid cohort, rounded to a whole percent.

Set `LOGIN_ANALYTICS_STARTED_AT` to the deployment's ISO-8601 capture start.
Without it, `completeFrom` remains null and a limitation is returned; the
earliest surviving TTL event is not treated as an authoritative rollout date.
`firstRetainedEventAt` always describes the TTL-backed event horizon.

### Onboarding funnel

The `onboarding.stages` array is cumulative: every later stage must also satisfy
all earlier stage conditions. Stages are:

1. Current non-admin account registered.
2. Email confirmed.
3. Current active-paid access.
4. Professional profile exists.
5. Onboarding tutorial completed.
6. Core details supplied: description, location, and at least one
   specialisation field.
7. Qualification summary approved.

Each stage returns a current count, percent of registered members, and drop-off
from the prior stage. This is a current-state funnel, not a historical event
ledger; checkout-created unconfirmed accounts remain in the first stage.

### Demand versus supply

`search.demandSupply.professions` and `.locations` return up to ten rows from
the selected search window:

- `searches`;
- `noResultSearches`;
- `supply`: currently discoverable profiles whose normalized main
  specialisation or location exactly matches the structured search dimension;
- `demandPerProfile`, or `null` when supply is zero;
- `status`: `no_supply`, `undersupplied`, or `covered`.

Zero-supply rows rank first, followed by undersupplied and covered demand.
`undersupplied` means at least one single-criterion no-result search or at least
three searches per matching profile. A zero-result combined query is not
attributed independently to each dimension. Exact matching is explainable but
can split synonymous or inconsistently named categories; do not present it as a
semantic market-size estimate.

Demand and supply use the same lowercase, trim, and internal-whitespace
normalization before exact matching.

Hard-deleted users are absent from historic membership totals. Search analytics
and login analytics start when their event capture is deployed and have no
historical backfill.

Member-level engagement fields are returned only from the admin-protected
overview. Names and emails come from the current `User` record for
identification and are not copied into `LoginEvent`. Do not expose these lists
through a public analytics route or client-side capture payload.

## Stripe Reconciliation Warning

The warning below is intentional and must not be removed merely to make the
dashboard appear clean:

> MongoDB reports active paid members, while the configured Stripe account
> returned a different active/trialing subscription count.

It appears whenever MongoDB's active-paid count differs from Stripe's
active/trialing subscription count. This also catches wrong accounts containing
only canceled or unrelated subscriptions. Separate warnings identify stale
cached Stripe results and multi-currency data.

At the 2026-07-29 live-development check:

- MongoDB reported 4 active paid members.
- All 4 had customer and subscription IDs.
- The configured Stripe account was test mode and returned 0 subscriptions and
  0 invoices.

Resolving it requires a coherent Stripe environment:

- API: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
  `STRIPE_PRICE_ANNUAL`.
- Client: `VITE_STRIPE_PUBLISHABLE_KEY`.

All values must belong to the same Stripe account and mode. Never commit them
or paste secret/webhook values into documentation or chat.

## Architecture

- Route/controller: `routes/analyticsRoutes.js`,
  `controllers/analyticsController.js`.
- Mongo membership, onboarding, demand/supply aggregation and search capture:
  `services/analyticsService.js`.
- Login capture/aggregation: `services/loginAnalyticsService.js`.
- Stripe pagination/cache: `services/stripeAnalyticsService.js`.
- Search storage: `models/searchEventModel.js`.
- Login storage: `models/loginEventModel.js`.
- Shared paid-member query: `utils/analyticsQueries.js`.
- Validation/timezone: `validators/analyticsValidator.js`,
  `utils/timezone.js`.
- Tests: `tests/analytics.test.js`.

Stripe results use a 10-minute in-process cache. Invoice/subscription list calls
paginate through `has_more` and `starting_after`. Refreshes have an eight-second
analytics timeout and serve the last cached result as explicitly stale when
available. Revenue uses actual `paid_at` boundaries and subscription-parent
invoices only; paid invoices without a valid `paid_at` are excluded rather than
silently assigned their creation time. A disabled/missing Stripe configuration
returns an explicit unavailable state. Renewals use item-level
`current_period_end`.

## Deployment checks and migrations

Run from `api/` before enabling analytics in production:

```bash
npm run ensure:analytics-indexes
npm run verify:stripe
```

`ensure:analytics-indexes` idempotently creates and then verifies the LoginEvent
and SearchEvent TTL/deduplication indexes through `listIndexes()`. It also
removes the obsolete `normalizedQuery` field from retained search events. A
retained LoginEvent maximum is backfilled into each current non-admin User's
durable `lastSuccessfulLoginAt`. A document containing `expiresAt` is not proof
that its TTL index exists; retain the command output in the deployment record.

`verify:stripe` checks key-mode coherence, proves the account and both configured
Price IDs are reachable, checks Price activity, and reports currencies without
printing credentials or Price values.

## Verification Baseline

- API suite baseline before login analytics: 10 test files passed.
- Login event privacy/retention and engagement aggregation tests pass.
- API suite after login analytics: 10 test files passed, 0 failed.
- A reversible configured-database smoke test created one timestamp-only event,
  received HTTP 200 with the engagement block and 12 monthly points, then
  deleted that exact event once.
- A read-only ranked-list smoke returned HTTP 200, zero current most-active
  rows and four current inactive paid rows, with the expected identity fields,
  ten-row caps, and the existing Stripe warning intact. No member identity was
  printed by the check.
- A read-only customer-behaviour smoke returned HTTP 200 with five health
  segment keys, a monotonic seven-stage onboarding funnel
  (`17 → 16 → 4 → 4 → 4 → 4 → 4`), empty demand/supply rows before real search
  capture, and the existing Stripe warning intact. No identity or search text
  was printed.
- Live protected overview: HTTP 200.
- Synthetic search event: HTTP 202; normalized, hashed, TTL-confirmed, then
  deleted exactly once.
- BST/GMT boundary, pagination, Stripe totals, renewal, validation, and safe
  admin-user serialization tests pass.
- Post-review remediation: the focused analytics file passes 19 tests covering
  signed receipt integrity/privacy, declared TTL/dedupe indexes, detached login
  capture, deletion cleanup, durable health recency, canonical inactive states,
  modern Stripe invoice/renewal shapes, stale timeout fallback, reconciliation
  warnings, and route middleware structure. The full API suite passes all 10
  test files.
- Production `listIndexes()` and authenticated Stripe account/Price probes are
  deployment checks and were not run against external services during the
  source/test remediation session.
