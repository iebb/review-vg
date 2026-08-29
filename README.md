# review.vg

A Cloudflare Worker that serves the review.vg static site, receives App Store Connect review emails at `report@review.vg`, parses their review lifecycle, and stores the public facts in D1. It accepts both ordinary forwards and batches of attached `.eml` / `message/rfc822` emails.

The public site uses one shared, date-scaled timeline with a synchronized axis and one y-series per app/OS. Apps represented on both iOS and macOS are grouped under one app identity with two adjacent platform series. The chart opens on the latest 30 days and can zoom or pan through the complete history. Its category selector filters both the chart and three top-five leaderboards: slowest rejections, slowest approvals, and fastest approvals. Each unique Submission ID is one rounded duration bar spanning submission to Apple's reply: red for a rejected review and green for an accepted review. Near-instant reviews retain a circle-sized minimum marker. On small screens, only the app icon remains frozen while the name and platform columns are removed, the timeline body scrolls in both directions, and the shared date axis stays pinned to the bottom. Separate submissions of the same app version remain separate bars. Rejected records expose only their App Review guideline in hover/focus details and leaderboard entries; issue descriptions and full rejection reasons are not public.

When an approval arrives, the Worker uses the public App Store ID in Apple's lookup API to fetch and store the app icon and primary category. The site links that icon to the public App Store page. Metadata lookup is bounded and fail-soft, so an Apple lookup outage does not discard a valid review result.

Only apps with a submission in the most recent 60 days are returned by the public timeline API. Until an app has an accepted review, its email-derived name is withheld and the site identifies it only as “Unapproved.”

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

Apple's issue description, full rejection reason, and next-steps text are retained only in private D1 fields and are never returned by the public API or displayed by the site. The public rejection detail is limited to the guideline code and title.

Forwarding addresses are stored privately for operational tracing but never published. Raw MIME is retained privately for parser compatibility work, automatically deleted after seven days, and capped at the newest 1,000 unique messages. Developer names, forwarding addresses, raw messages, and organization UUIDs are not published. Canonical App Store submission IDs are the D1 primary keys and deduplicate records.

Every valid App Store Connect organization UUID is accepted. The submission ID in the message body must match the submission ID in its App Store Connect URL. Records are deduplicated by that canonical submission ID.

## Local development

```sh
npm install
npm run cf-types
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Run checks with `npm run check`.

## Cloudflare resources

- Worker: `review-vg`
- D1: `review-vg`, binding `DB`
- Static assets: `public/`, binding `ASSETS`
- Custom domain: `review.vg`
- Email Routing rule: `*@review.vg` → Worker `review-vg`
- Daily cron: purge raw messages older than seven days and enforce the 1,000-message cap

Apply production migrations before deploying a schema-dependent Worker:

```sh
npm run db:migrate:remote
npm run deploy
```

The UI self-hosts the Geologica variable font. Its SIL Open Font License is included at `public/fonts/OFL.txt`.
