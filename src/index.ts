import { extractReviewsFromEmail, parseInboundEmail } from "./email-ingest";
import { approveGmailForwarding, gmailForwardingConfirmationUrl } from "./gmail-forwarding";
import { fetchAppStoreMetadata, type AppStoreMetadata, type Fetcher } from "./app-store";
import type { ParsedReviewEmail } from "./parser";

const MAX_EMAIL_BYTES = 20 * 1024 * 1024;
const RAW_EMAIL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RAW_EMAIL_MAX_MESSAGES = 1000;
const RAW_EMAIL_CHUNK_BYTES = 1_500_000;
const APP_METADATA_BACKFILL_LIMIT = 50;

interface ForwardingSourceEmail {
  from?: { address?: string };
  headers: Array<{ key: string; value: string }>;
}

interface RawEmailMetadata {
  envelopeFrom: string;
  envelopeTo: string;
  messageId: string | null;
  subject: string | null;
}

interface ExistingMetadataRow {
  app_store_id: string;
  app_icon_url: string | null;
  app_category: string | null;
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  },

  async email(message, env): Promise<void> {
    if (!isReviewRecipient(message.to)) {
      message.setReject("Unknown review.vg recipient");
      return;
    }
    if (message.rawSize > MAX_EMAIL_BYTES) {
      message.setReject("Email is too large to process");
      return;
    }

    try {
      const raw = await new Response(message.raw).arrayBuffer();
      await archiveIncomingEmail(env.DB, raw, {
        envelopeFrom: message.from,
        envelopeTo: message.to,
        messageId: message.headers.get("message-id"),
        subject: message.headers.get("subject"),
      });
      const parsedMime = await parseInboundEmail(raw);
      const gmailConfirmation = gmailForwardingConfirmationUrl(parsedMime, message.from);
      if (gmailConfirmation) {
        await approveGmailForwarding(gmailConfirmation);
        console.log(JSON.stringify({ event: "gmail_forwarding_approved" }));
        return;
      }

      const authenticationHeaders = [
        message.headers.get("authentication-results") ?? "",
        message.headers.get("arc-authentication-results") ?? "",
      ].join("\n");
      const extracted = await extractReviewsFromEmail(parsedMime, message.from, authenticationHeaders);

      if (extracted.reviews.length === 0) {
        message.setReject("Only Apple App Store review result emails are accepted");
        return;
      }

      await ensureApprovedAppMetadata(env.DB, extracted.reviews);
      const stored = await storeReviews(
        env.DB,
        extracted.reviews,
        forwardedFromAddress(parsedMime, message.from),
      );
      console.log(
        JSON.stringify({
          event: "review_email_stored",
          submissions: stored.submissions,
          attachedEmailsSeen: extracted.attachedEmailsSeen,
          skippedAttachments: extracted.skippedAttachments,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "review_email_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      throw error;
    }
  },

  async scheduled(_controller, env): Promise<void> {
    await purgeRawEmails(env.DB);
    try {
      const result = await backfillApprovedAppMetadata(env.DB);
      if (result.appsChecked > 0) {
        console.log(JSON.stringify({ event: "app_store_metadata_backfilled", ...result }));
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: "app_store_metadata_backfill_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  },
} satisfies ExportedHandler<Env>;

export async function archiveIncomingEmail(
  db: D1Database,
  raw: ArrayBuffer,
  metadata: RawEmailMetadata,
): Promise<string> {
  const receivedAt = new Date();
  const expiresAt = new Date(receivedAt.getTime() + RAW_EMAIL_RETENTION_MS);
  const id = await sha256Hex(raw);
  const bytes = new Uint8Array(raw);
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += RAW_EMAIL_CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, Math.min(offset + RAW_EMAIL_CHUNK_BYTES, bytes.byteLength)));
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `DELETE FROM raw_emails
        WHERE julianday(expires_at) <= julianday('now')`,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO raw_emails
         (id, received_at, expires_at, envelope_from, envelope_to, message_id,
          subject, raw_size, chunk_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      receivedAt.toISOString(),
      expiresAt.toISOString(),
      boundedArchiveValue(metadata.envelopeFrom, 512),
      boundedArchiveValue(metadata.envelopeTo, 512),
      boundedArchiveValue(metadata.messageId, 2048),
      boundedArchiveValue(metadata.subject, 4096),
      bytes.byteLength,
      chunks.length,
    ),
    ...chunks.map((chunk, index) => db.prepare(
      `INSERT OR IGNORE INTO raw_email_chunks (email_id, chunk_index, raw_chunk)
       VALUES (?, ?, ?)`,
    ).bind(id, index, chunk)),
    db.prepare(
      `DELETE FROM raw_emails
        WHERE id IN (
          SELECT id
            FROM raw_emails
           ORDER BY received_at DESC, id DESC
           LIMIT -1 OFFSET ${RAW_EMAIL_MAX_MESSAGES}
        )`,
    ),
  ];
  await db.batch(statements);
  return id;
}

export async function purgeRawEmails(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `DELETE FROM raw_emails
        WHERE julianday(expires_at) <= julianday('now')`,
    ),
    db.prepare(
      `DELETE FROM raw_emails
        WHERE id IN (
          SELECT id
            FROM raw_emails
           ORDER BY received_at DESC, id DESC
           LIMIT -1 OFFSET ${RAW_EMAIL_MAX_MESSAGES}
        )`,
    ),
  ]);
}

export async function backfillApprovedAppMetadata(
  db: D1Database,
  fetcher: Fetcher = fetch,
): Promise<{ appsChecked: number; appsUpdated: number }> {
  const missing = await db.prepare(
    `WITH approved_apps AS (
       SELECT app_store_id,
              MAX(COALESCE(successful_at, latest_event_at)) AS approved_at
         FROM reviews
        WHERE status = 'success'
          AND app_store_id IS NOT NULL
        GROUP BY app_store_id
     )
     SELECT approved.app_store_id,
            metadata.app_icon_url,
            metadata.app_category
       FROM approved_apps AS approved
       LEFT JOIN app_metadata AS metadata
         ON metadata.app_store_id = approved.app_store_id
      WHERE metadata.app_store_id IS NULL
         OR metadata.app_icon_url IS NULL
         OR metadata.app_category IS NULL
      ORDER BY COALESCE(metadata.last_checked_at, '') ASC,
               approved.approved_at DESC,
               approved.app_store_id
      LIMIT ${APP_METADATA_BACKFILL_LIMIT}`,
  ).all<ExistingMetadataRow>();
  const appStoreIds = missing.results.map((row) => row.app_store_id);
  if (appStoreIds.length === 0) return { appsChecked: 0, appsUpdated: 0 };

  const metadata = await fetchAppStoreMetadata(appStoreIds, fetcher);
  await storeAppMetadataChecks(db, appStoreIds, metadata);
  const appsUpdated = appStoreIds.filter((appStoreId) => {
    const value = metadata.get(appStoreId);
    return Boolean(value?.iconUrl || value?.category);
  }).length;

  return { appsChecked: appStoreIds.length, appsUpdated };
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function boundedArchiveValue(value: string | null, maximumLength: number): string | null {
  return typeof value === "string" ? value.slice(0, maximumLength) : null;
}

async function ensureApprovedAppMetadata(
  db: D1Database,
  reviews: ParsedReviewEmail[],
): Promise<void> {
  const appStoreIds = [...new Set(
    reviews
      .filter((review) => review.status === "success")
      .map((review) => review.appStoreId),
  )];
  if (appStoreIds.length === 0) return;

  const placeholders = appStoreIds.map(() => "?").join(", ");
  const existing = await db
    .prepare(
      `SELECT app_store_id, app_icon_url, app_category
         FROM app_metadata
        WHERE app_store_id IN (${placeholders})
        ORDER BY app_store_id`,
    )
    .bind(...appStoreIds)
    .all<ExistingMetadataRow>();
  const metadata = new Map<string, AppStoreMetadata>(existing.results.map((row) => [
    row.app_store_id,
    { iconUrl: row.app_icon_url, category: row.app_category },
  ]));

  const approvedIds = appStoreIds.filter((appStoreId) => {
    const current = metadata.get(appStoreId);
    return !current?.iconUrl || !current.category;
  });

  for (let offset = 0; offset < approvedIds.length; offset += 50) {
    const batch = approvedIds.slice(offset, offset + 50);
    try {
      const fetched = await fetchAppStoreMetadata(batch);
      await storeAppMetadataChecks(db, batch, fetched);
    } catch (error) {
      console.warn(JSON.stringify({
        event: "app_store_metadata_lookup_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }
}

async function storeAppMetadataChecks(
  db: D1Database,
  appStoreIds: string[],
  metadata: Map<string, AppStoreMetadata>,
): Promise<void> {
  if (appStoreIds.length === 0) return;
  await db.batch(appStoreIds.map((appStoreId) => {
    const value = metadata.get(appStoreId);
    return db.prepare(
      `INSERT INTO app_metadata (
         app_store_id, app_icon_url, app_category, last_checked_at, updated_at
       ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(app_store_id) DO UPDATE SET
         app_icon_url = COALESCE(excluded.app_icon_url, app_metadata.app_icon_url),
         app_category = COALESCE(excluded.app_category, app_metadata.app_category),
         last_checked_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(appStoreId, value?.iconUrl ?? null, value?.category ?? null);
  }));
}

async function storeReviews(
  db: D1Database,
  reviews: ParsedReviewEmail[],
  forwardedFrom: string | null,
): Promise<{ submissions: number }> {
  const statements: D1PreparedStatement[] = [];

  for (const review of reviews) {
    statements.push(
      db
      .prepare(
         `INSERT INTO reviews (
           submission_id, app_name, platform, organization_id, app_store_id, app_version,
           status, submitted_at, issue_at, successful_at, latest_event_at, submitted_via,
           guideline_code, guideline_title, rejection_reason, issue_description, next_steps,
           forwarded_from, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(submission_id) DO UPDATE SET
           app_name = excluded.app_name,
           platform = excluded.platform,
           organization_id = COALESCE(excluded.organization_id, reviews.organization_id),
           app_store_id = COALESCE(excluded.app_store_id, reviews.app_store_id),
           app_version = COALESCE(excluded.app_version, reviews.app_version),
           status = CASE
             WHEN excluded.status = 'success' OR reviews.status = 'success' THEN 'success'
             ELSE 'issue'
           END,
           submitted_at = COALESCE(reviews.submitted_at, excluded.submitted_at),
           issue_at = COALESCE(reviews.issue_at, excluded.issue_at),
           successful_at = COALESCE(reviews.successful_at, excluded.successful_at),
           latest_event_at = CASE
             WHEN excluded.latest_event_at > reviews.latest_event_at THEN excluded.latest_event_at
             ELSE reviews.latest_event_at
           END,
           submitted_via = COALESCE(reviews.submitted_via, excluded.submitted_via),
           guideline_code = COALESCE(reviews.guideline_code, excluded.guideline_code),
           guideline_title = COALESCE(reviews.guideline_title, excluded.guideline_title),
           rejection_reason = COALESCE(reviews.rejection_reason, excluded.rejection_reason),
           issue_description = COALESCE(reviews.issue_description, excluded.issue_description),
           next_steps = COALESCE(reviews.next_steps, excluded.next_steps),
           forwarded_from = COALESCE(reviews.forwarded_from, excluded.forwarded_from),
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        review.submissionId,
        review.appName,
        review.platform,
        review.organizationId,
        review.appStoreId,
        review.appVersion,
        review.status,
        review.submittedAt,
        review.issueAt,
        review.successfulAt,
        review.eventAt,
        review.submittedVia,
        review.guidelineCode,
        review.guidelineTitle,
        review.rejectionReason,
        review.issueDescription,
        review.nextSteps,
        forwardedFrom,
      ),
    );
  }

  await db.batch(statements);
  return {
    submissions: new Set(reviews.map((review) => review.submissionId)).size,
  };
}

export function forwardedFromAddress(
  email: ForwardingSourceEmail,
  envelopeFrom: string,
): string | null {
  const visibleFrom = normalizedEmailAddress(email.from?.address ?? "");
  if (visibleFrom && !isServiceSender(visibleFrom)) return visibleFrom;

  const envelopeAddress = normalizedForwardingEnvelope(envelopeFrom);
  if (envelopeAddress && !isServiceSender(envelopeAddress)) return envelopeAddress;

  for (const header of email.headers) {
    if (header.key.toLowerCase() !== "x-forwarded-for") continue;
    const candidates = header.value.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    for (const candidate of candidates) {
      const address = normalizedEmailAddress(candidate);
      if (address && !isServiceSender(address)) return address;
    }
  }
  return null;
}

function normalizedForwardingEnvelope(value: string): string | null {
  const address = normalizedEmailAddress(value);
  if (!address) return null;
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const cafMarker = local.indexOf("+caf_=");
  if (cafMarker > 0) return `${local.slice(0, cafMarker)}${address.slice(at)}`;
  return address;
}

function normalizedEmailAddress(value: string): string | null {
  const match = value.trim().match(/<?([^\s<>@]+@[^\s<>@]+)>?$/);
  if (!match) return null;
  const address = match[1].toLowerCase();
  return address.length <= 254 ? address : null;
}

function isServiceSender(address: string): boolean {
  return isReviewRecipient(address) ||
    address === "no_reply@email.apple.com" ||
    address === "forwarding-noreply@google.com";
}

export function isReviewRecipient(value: string): boolean {
  const address = normalizedEmailAddress(value);
  if (!address) return false;
  const at = address.lastIndexOf("@");
  return at > 0 && address.slice(at + 1) === "review.vg";
}
