# review.vg

A static Cloudflare site backed by an Email Worker and D1. The Worker receives App Store Connect review emails at `apple@review.vg`, parses their review lifecycle, and stores the results in D1. It accepts both ordinary forwards and batches of attached `.eml` / `message/rfc822` emails. Email Routing remains a catch-all, so any local part at `review.vg` reaches the same Worker.

The public timeline is built once per day by a scheduled Codex project task. Each run uses a clean copy of `origin/master`, runs the privacy-limited query in `scripts/public-reviews.sql`, validates and serializes the result to `public/review-data.js`, tests the project, and deploys the static assets. Page visits load that prebuilt file directly: there is no public timeline API, no request-time Worker execution for site assets, and no request-time D1 query.

The public site uses one shared, date-scaled timeline with a synchronized axis and one y-series per app/OS. iOS, macOS, tvOS, and visionOS are preserved as distinct platform series and grouped under one app identity when an app appears on multiple platforms. The chart covers the latest six calendar months, opens on the latest 30 days, and can zoom or pan within that window. Its category selector filters both the chart and three all-history top-10 leaderboards: slowest rejections, slowest approvals, and fastest approvals. Each unique Submission ID is one rounded duration bar spanning submission to Apple's reply: red for a rejected review and green for an accepted review. Near-instant reviews retain a circle-sized minimum marker. On small screens, only the app icon remains frozen while the name and platform columns are removed, the timeline body scrolls in both directions, and the shared date axis stays pinned to the bottom. Separate submissions of the same app version remain separate bars. Rejected records expose only their App Review guideline in hover/focus details and leaderboard entries; issue descriptions and full rejection reasons are not public.

When an approval arrives, the Worker uses the public App Store ID in Apple's lookup API to fetch the app icon and primary category into a dedicated `app_metadata` table. The hourly maintenance job retries approved apps with missing metadata, with `last_checked_at` keeping retries fair when several listings are unavailable. The site links that icon to the public App Store page. Metadata lookup is bounded and fail-soft, so an Apple lookup outage does not discard a valid review result.

Timeline events are limited to submissions from the latest six months. Never-approved apps appear there only when their latest submission is within 60 days; approved apps can use the full six-month window. Leaderboards rank all recorded history. Until an app has an accepted review, the interface initially identifies it as “Unapproved.” Its name arrives with the public data and is revealed immediately when a visitor clicks the label or fallback icon; the click never makes another request.

Gmail automatic-forwarding verification emails from the exact visible sender `forwarding-noreply@google.com` are approved automatically, including mail delivered through Google's bounce-envelope domains. The Worker loads a validated Google `mail/vf-…` confirmation page, submits its confirmation form, and requires Gmail's success response without storing the forwarding address, token, or cookies.

## What is stored

- App name and platform
- App version
- Public App Store ID, App Store icon URL, and primary category, when present
- Canonical App Store submission ID, used as the public logical key
- The App Store Connect organization UUID from each valid message (stored privately)
- Submitted, issue, and successful timestamps
- Review status, guideline, issue description, and next steps
- A rejection reason assembled from the guideline and issue description
- The exact raw MIME message in private, chunked D1 rows for seven days

Apple's issue description, full rejection reason, and next-steps text are retained only in private D1 fields and are never selected by the public build or displayed by the site. The public rejection detail is limited to the guideline code and title.

Forwarding addresses are stored privately for operational tracing but never published. Raw MIME is retained privately for parser compatibility work, automatically deleted after seven days, and capped at the newest 1,000 unique messages. Developer names, forwarding addresses, raw messages, and organization UUIDs are not published. Canonical App Store submission IDs are the D1 primary keys and deduplicate records.

Every valid App Store Connect organization UUID is accepted. The submission ID in the message body must match the submission ID in its App Store Connect URL. Records are deduplicated by that canonical submission ID.

## Local development

```sh
npm install
npm run cf-types
npm run db:migrate:local
npm run db:seed:local
npm run build:data:local
npm run dev
```

Run checks with `npm run check`. `npm run build:data` refreshes `public/review-data.js` from production D1; `npm run build:data:local` uses the local D1 database.

## Production snapshot build

The scheduled local task runs daily at 03:17 Asia/Tokyo using the authenticated Cloudflare session on its host. It builds and deploys from a temporary clone of `origin/master`, so the saved project checkout and its uncommitted work are not modified. A manual production refresh uses the same three commands shown below.

The build refuses to deploy an empty result, duplicate Submission IDs, malformed timestamps, unexpected statuses, or non-HTTPS icon URLs. Its SQL projection intentionally omits forwarding addresses, organization UUIDs, raw messages, issue descriptions, full rejection reasons, and next steps.

## Cloudflare resources

- Worker: `review-vg`
- D1: `review-vg`, binding `DB`
- Static assets: `public/`, served directly before the Worker
- Custom domain: `review.vg`
- Email Routing rule: `*@review.vg` → Worker `review-vg`
- Hourly cron: purge raw messages older than seven days and enforce the 1,000-message cap
- Daily Codex project schedule: rebuild the public snapshot and deploy

Apply production migrations before deploying a schema-dependent Worker:

```sh
npm run db:migrate:remote
npm run build:data
npm run check
npm run deploy
```

The UI self-hosts the Geologica variable font. Its SIL Open Font License is included at `public/fonts/OFL.txt`.
The 1200×630 Open Graph image is stored at `public/og-image.png` and is referenced by both Open Graph and Twitter large-card metadata.
