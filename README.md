# review.vg

A Cloudflare Worker that serves the review.vg static site, receives App Store Connect review emails at `report@review.vg`, parses their review lifecycle, and stores the public facts in D1. It accepts both ordinary forwards and batches of attached `.eml` / `message/rfc822` emails.

The public site includes a timeline for every app and operating-system pair: each unique Submission ID is one block, rounded red for a failed review and rounded green for an accepted review. Separate submissions of the same app version remain separate blocks.

Gmail automatic-forwarding verification emails from the exact visible sender `forwarding-noreply@google.com` are approved automatically, including mail delivered through Google's bounce-envelope domains. The Worker loads a validated Google `mail/vf-…` confirmation page, submits its confirmation form, and requires Gmail's success response without storing the forwarding address, token, or cookies.

## What is stored

- App name and platform
- App version
- Public App Store ID, when present
- Canonical App Store submission ID, used as the public logical key
- The App Store Connect organization UUID from each valid message (stored privately)
- Submitted, issue, and successful timestamps
- Review status, guideline, issue description, and next steps
- A complete rejection reason assembled from the guideline, issue description, and next steps

Forwarding addresses and raw MIME are not stored. Developer names and organization UUIDs are not published. Canonical App Store submission IDs are the D1 primary keys and deduplicate records.

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
- Email Routing rule: `report@review.vg` → Worker `review-vg`

Apply production migrations before deploying a schema-dependent Worker:

```sh
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```
