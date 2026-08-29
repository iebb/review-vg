import { extractReviewsFromEmail, parseInboundEmail } from "./email-ingest";
import { approveGmailForwarding, gmailForwardingConfirmationUrl } from "./gmail-forwarding";
import type { ParsedReviewEmail } from "./parser";

const REPORT_ADDRESS = "report@review.vg";
const MAX_EMAIL_BYTES = 20 * 1024 * 1024;

interface ReviewRow {
  submission_id: string;
  app_name: string;
  platform: string;
  app_store_id: string | null;
  app_version: string | null;
  status: "issue" | "success";
  submitted_at: string | null;
  issue_at: string | null;
  successful_at: string | null;
  latest_event_at: string;
  guideline_code: string | null;
  guideline_title: string | null;
  rejection_reason: string | null;
  issue_description: string | null;
  next_steps: string | null;
  verification: "apple-authenticated" | "forwarded-email";
}

interface StatsRow {
  total: number;
  successful: number;
  issues: number;
  avg_review_seconds: number | null;
}

interface TimelineEventRow {
  submission_id: string;
  app_name: string;
  platform: string;
  app_version: string | null;
  event_type: "issue" | "success";
  occurred_at: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/reviews" && request.method === "GET") {
      return getReviews(request, env);
    }
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
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
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

      const stored = await storeReviews(env.DB, extracted.reviews);
      console.log(
        JSON.stringify({
          event: "review_email_stored",
          submissions: stored.submissions,
          events: stored.events,
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

async function getReviews(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status");
  const status = requestedStatus === "issue" || requestedStatus === "success" ? requestedStatus : null;
  const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

  const where = status ? "WHERE status = ?" : "";
  const reviewStatement = env.DB.prepare(
      `SELECT submission_id, app_name, platform, app_store_id, app_version, status,
            submitted_at, issue_at, successful_at, latest_event_at,
            guideline_code, guideline_title, rejection_reason, issue_description, next_steps, verification
       FROM reviews
       ${where}
      ORDER BY latest_event_at DESC
      LIMIT ?`,
  );
  const boundReviews = status ? reviewStatement.bind(status, limit) : reviewStatement.bind(limit);
  const [reviewResult, statsResult] = await env.DB.batch<ReviewRow | StatsRow>([
    boundReviews,
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
              SUM(CASE WHEN status = 'issue' THEN 1 ELSE 0 END) AS issues,
              AVG(CASE
                    WHEN submitted_at IS NOT NULL AND successful_at IS NOT NULL
                    THEN unixepoch(successful_at) - unixepoch(submitted_at)
                  END) AS avg_review_seconds
         FROM reviews`,
    ),
  ]);

  const stats = statsResult.results[0] as unknown as StatsRow | undefined;
  const reviews = (reviewResult.results as unknown as ReviewRow[]).map(toPublicReview);
  return json(
    {
      reviews,
      stats: {
        total: Number(stats?.total ?? 0),
        successful: Number(stats?.successful ?? 0),
        issues: Number(stats?.issues ?? 0),
        averageReviewSeconds: stats?.avg_review_seconds === null ? null : Number(stats?.avg_review_seconds ?? 0),
      },
    },
    200,
    { "Cache-Control": "public, max-age=30, s-maxage=60" },
  );
}

async function getTimeline(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT e.submission_id, r.app_name, r.platform, r.app_version,
            e.event_type, e.occurred_at
       FROM review_events AS e
       JOIN reviews AS r ON r.submission_id = e.submission_id
      ORDER BY e.occurred_at ASC
      LIMIT 1000`,
  ).all<TimelineEventRow>();

  return json(
    {
      events: result.results.map((event) => ({
        submissionId: event.submission_id,
        appName: event.app_name,
        platform: event.platform,
        appVersion: event.app_version,
        status: event.event_type,
        occurredAt: event.occurred_at,
      })),
    },
    200,
    { "Cache-Control": "public, max-age=30, s-maxage=60" },
  );
}

async function storeReviews(
  db: D1Database,
  reviews: ParsedReviewEmail[],
): Promise<{ submissions: number; events: number }> {
  const statements: D1PreparedStatement[] = [];

  for (const review of reviews) {
    const eventKey = `${review.submissionId}:${review.status}:${review.eventAt}`;
    statements.push(
      db
      .prepare(
        `INSERT INTO reviews (
           submission_id, app_name, platform, organization_id, app_store_id, app_version,
           status, submitted_at, issue_at, successful_at, latest_event_at, submitted_via,
           guideline_code, guideline_title, rejection_reason, issue_description, next_steps, verification, updated_at
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
           verification = CASE
             WHEN excluded.verification = 'apple-authenticated' OR reviews.verification = 'apple-authenticated'
             THEN 'apple-authenticated'
             ELSE 'forwarded-email'
           END,
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
        review.verification,
      ),
      db
        .prepare(
        `INSERT OR IGNORE INTO review_events (event_key, submission_id, event_type, occurred_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(eventKey, review.submissionId, review.status, review.eventAt),
    );
  }

  await db.batch(statements);
  return {
    submissions: new Set(reviews.map((review) => review.submissionId)).size,
    events: reviews.length,
  };
}

function toPublicReview(row: ReviewRow) {
  return {
    id: row.submission_id,
    submissionId: row.submission_id,
    appName: row.app_name,
    platform: row.platform,
    appStoreId: row.app_store_id,
    appVersion: row.app_version,
    status: row.status,
    submittedAt: row.submitted_at,
    issueAt: row.issue_at,
    successfulAt: row.successful_at,
    latestEventAt: row.latest_event_at,
    guidelineCode: row.guideline_code,
    guidelineTitle: row.guideline_title,
    rejectionReason: row.rejection_reason,
    issueDescription: row.issue_description,
    nextSteps: row.next_steps,
    verification: row.verification,
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
