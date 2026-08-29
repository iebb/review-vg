import { extractReviewsFromEmail, parseInboundEmail } from "./email-ingest";
import { approveGmailForwarding, gmailForwardingConfirmationUrl } from "./gmail-forwarding";
import { fetchAppStoreMetadata, type AppStoreMetadata } from "./app-store";
import type { ParsedReviewEmail } from "./parser";

const REPORT_ADDRESS = "report@review.vg";
const MAX_EMAIL_BYTES = 20 * 1024 * 1024;

interface TimelineEventRow {
  submission_id: string;
  app_name: string | null;
  platform: string;
  app_store_id: string | null;
  app_icon_url: string | null;
  app_category: string | null;
  app_version: string | null;
  status: "issue" | "success";
  submitted_at: string | null;
  latest_event_at: string;
  rejection_reason: string | null;
  has_approved: number;
}

interface ExistingMetadataRow {
  app_store_id: string;
  app_icon_url: string | null;
  app_category: string | null;
}

interface StoredReview extends ParsedReviewEmail {
  appIconUrl: string | null;
  appCategory: string | null;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/timeline" && request.method === "GET") {
      return getTimeline(env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.mzstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    );
    headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    if (url.pathname.endsWith(".css") || url.pathname.endsWith(".js")) {
      headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
    }
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },

  async email(message, env): Promise<void> {
    if (message.to.toLowerCase() !== REPORT_ADDRESS) {
      message.setReject("Unknown review.vg recipient");
      return;
    }
    if (message.rawSize > MAX_EMAIL_BYTES) {
      message.setReject("Email is too large to process");
      return;
    }

    try {
      const raw = await new Response(message.raw).arrayBuffer();
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

      const reviewsWithMetadata = await enrichReviewMetadata(env.DB, extracted.reviews);
      const stored = await storeReviews(env.DB, reviewsWithMetadata);
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
} satisfies ExportedHandler<Env>;

export async function getTimeline(env: Pick<Env, "DB">): Promise<Response> {
  const result = await env.DB.prepare(
    `WITH eligible_apps AS (
       SELECT app_store_id,
              MAX(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS has_approved
         FROM reviews
        WHERE app_store_id IS NOT NULL
        GROUP BY app_store_id
       HAVING MAX(julianday(COALESCE(submitted_at, latest_event_at))) >=
              julianday('now', '-60 days')
     ), latest_events AS (
       SELECT r.submission_id,
              CASE
                WHEN eligible.has_approved = 1 THEN (
                  SELECT approved.app_name
                    FROM reviews AS approved
                   WHERE approved.app_store_id = r.app_store_id
                     AND approved.status = 'success'
                   ORDER BY approved.successful_at DESC, approved.latest_event_at DESC
                   LIMIT 1
                )
                ELSE NULL
              END AS app_name,
              r.platform, r.app_store_id, r.app_version, r.status, r.submitted_at,
              r.latest_event_at, r.rejection_reason, eligible.has_approved,
              COALESCE(
                r.app_icon_url,
                (
                  SELECT icon.app_icon_url
                    FROM reviews AS icon
                   WHERE icon.app_store_id = r.app_store_id
                     AND icon.app_icon_url IS NOT NULL
                   ORDER BY icon.successful_at DESC, icon.latest_event_at DESC
                   LIMIT 1
                )
              ) AS app_icon_url,
              COALESCE(
                r.app_category,
                (
                  SELECT category.app_category
                    FROM reviews AS category
                   WHERE category.app_store_id = r.app_store_id
                     AND category.app_category IS NOT NULL
                   ORDER BY category.successful_at DESC, category.latest_event_at DESC
                   LIMIT 1
                )
              ) AS app_category
         FROM reviews AS r
         JOIN eligible_apps AS eligible ON eligible.app_store_id = r.app_store_id
        ORDER BY r.latest_event_at DESC
        LIMIT 1000
     )
     SELECT *
       FROM latest_events
      ORDER BY latest_event_at ASC`,
  ).all<TimelineEventRow>();

  return json(
    {
      events: result.results.map((event) => ({
        submissionId: event.submission_id,
        appName: event.has_approved === 1 ? event.app_name : null,
        platform: event.platform,
        appStoreId: event.app_store_id,
        appIconUrl: event.app_icon_url,
        appCategory: event.app_category,
        appVersion: event.app_version,
        status: event.status,
        submittedAt: event.submitted_at,
        occurredAt: event.latest_event_at,
        rejectionReason: event.status === "issue" ? event.rejection_reason : null,
      })),
    },
    200,
    { "Cache-Control": "public, max-age=30, s-maxage=60" },
  );
}

async function enrichReviewMetadata(
  db: D1Database,
  reviews: ParsedReviewEmail[],
): Promise<StoredReview[]> {
  const appStoreIds = [...new Set(reviews.map((review) => review.appStoreId))];
  if (appStoreIds.length === 0) {
    return reviews.map((review) => ({ ...review, appIconUrl: null, appCategory: null }));
  }

  const placeholders = appStoreIds.map(() => "?").join(", ");
  const existing = await db
    .prepare(
      `SELECT app_store_id,
              MAX(app_icon_url) AS app_icon_url,
              MAX(app_category) AS app_category
         FROM reviews
        WHERE app_store_id IN (${placeholders})
        GROUP BY app_store_id`,
    )
    .bind(...appStoreIds)
    .all<ExistingMetadataRow>();
  const metadata = new Map<string, AppStoreMetadata>(existing.results.map((row) => [
    row.app_store_id,
    { iconUrl: row.app_icon_url, category: row.app_category },
  ]));

  const approvedIds = [...new Set(
    reviews
      .filter((review) => {
        const current = metadata.get(review.appStoreId);
        return review.status === "success" && (!current?.iconUrl || !current.category);
      })
      .map((review) => review.appStoreId),
  )];

  for (let offset = 0; offset < approvedIds.length; offset += 50) {
    try {
      const fetched = await fetchAppStoreMetadata(approvedIds.slice(offset, offset + 50));
      for (const [appStoreId, value] of fetched) {
        const current = metadata.get(appStoreId);
        metadata.set(appStoreId, {
          iconUrl: value.iconUrl ?? current?.iconUrl ?? null,
          category: value.category ?? current?.category ?? null,
        });
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: "app_store_metadata_lookup_failed",
        error: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }

  return reviews.map((review) => ({
    ...review,
    appIconUrl: metadata.get(review.appStoreId)?.iconUrl ?? null,
    appCategory: metadata.get(review.appStoreId)?.category ?? null,
  }));
}

async function storeReviews(
  db: D1Database,
  reviews: StoredReview[],
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
           app_icon_url, app_category, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
           app_icon_url = COALESCE(excluded.app_icon_url, reviews.app_icon_url),
           app_category = COALESCE(excluded.app_category, reviews.app_category),
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
        review.appIconUrl,
        review.appCategory,
      ),
    );
  }

  await db.batch(statements);
  return {
    submissions: new Set(reviews.map((review) => review.submissionId)).size,
  };
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}
