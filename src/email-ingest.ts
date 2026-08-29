import PostalMime, { type Attachment, type Email, type PostalMimeOptions, type RawEmail } from "postal-mime";
import { parseReviewEmail, type ParsedReviewEmail } from "./parser";

const MAX_ATTACHED_EMAILS = 50;
const MAX_ATTACHED_DEPTH = 3;
const MAX_ATTACHED_EMAIL_BYTES = 2 * 1024 * 1024;

const MIME_OPTIONS = {
  forceRfc822Attachments: true,
  attachmentEncoding: "arraybuffer",
  maxNestingDepth: 30,
  maxHeadersSize: 256 * 1024,
  maxRfc822NestingDepth: 0,
} satisfies PostalMimeOptions;

interface QueuedEmail {
  email: Email;
  envelopeFrom: string;
  extraAuthenticationHeaders: string;
  depth: number;
}

export interface ExtractedReviews {
  reviews: ParsedReviewEmail[];
  attachedEmailsSeen: number;
  skippedAttachments: number;
}

export async function extractReviewsFromMime(
  raw: RawEmail,
  envelopeFrom: string,
  extraAuthenticationHeaders = "",
): Promise<ExtractedReviews> {
  const root = await parseInboundEmail(raw);
  return extractReviewsFromEmail(root, envelopeFrom, extraAuthenticationHeaders);
}

export async function parseInboundEmail(raw: RawEmail): Promise<Email> {
  return PostalMime.parse(raw, MIME_OPTIONS);
}

export async function extractReviewsFromEmail(
  root: Email,
  envelopeFrom: string,
  extraAuthenticationHeaders = "",
): Promise<ExtractedReviews> {
  const queue: QueuedEmail[] = [
    { email: root, envelopeFrom, extraAuthenticationHeaders, depth: 0 },
  ];
  const reviews: ParsedReviewEmail[] = [];
  let attachedEmailsSeen = 0;
  let skippedAttachments = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const parsed = parseReviewEmail(toEmailInput(current));
    if (parsed) {
      reviews.push(parsed);
    }

    if (current.depth >= MAX_ATTACHED_DEPTH) continue;

    for (const attachment of current.email.attachments) {
      if (!isAttachedEmail(attachment)) continue;
      if (attachedEmailsSeen >= MAX_ATTACHED_EMAILS) {
        skippedAttachments += 1;
        continue;
      }
      if (attachmentSize(attachment) > MAX_ATTACHED_EMAIL_BYTES) {
        skippedAttachments += 1;
        continue;
      }

      attachedEmailsSeen += 1;
      try {
        const nested = await PostalMime.parse(attachment.content, MIME_OPTIONS);
        queue.push({
          email: nested,
          envelopeFrom,
          extraAuthenticationHeaders: "",
          depth: current.depth + 1,
        });
      } catch {
        skippedAttachments += 1;
      }
    }
  }

  return {
    reviews: deduplicateSubmissions(reviews),
    attachedEmailsSeen,
    skippedAttachments,
  };
}

export function deduplicateSubmissions(reviews: ParsedReviewEmail[]): ParsedReviewEmail[] {
  const unique = new Map<string, ParsedReviewEmail>();
  for (const review of reviews) {
    const existing = unique.get(review.submissionId);
    unique.set(review.submissionId, existing ? mergeSubmission(existing, review) : review);
  }
  return [...unique.values()];
}

function mergeSubmission(
  existing: ParsedReviewEmail,
  incoming: ParsedReviewEmail,
): ParsedReviewEmail {
  const newer = incoming.eventAt > existing.eventAt ? incoming : existing;
  return {
    ...newer,
    appVersion: newer.appVersion ?? existing.appVersion ?? incoming.appVersion,
    status: existing.status === "success" || incoming.status === "success" ? "success" : "issue",
    submittedAt: existing.submittedAt ?? incoming.submittedAt,
    issueAt: existing.issueAt ?? incoming.issueAt,
    successfulAt: existing.successfulAt ?? incoming.successfulAt,
    eventAt: existing.eventAt > incoming.eventAt ? existing.eventAt : incoming.eventAt,
    submittedVia: existing.submittedVia ?? incoming.submittedVia,
    guidelineCode: existing.guidelineCode ?? incoming.guidelineCode,
    guidelineTitle: existing.guidelineTitle ?? incoming.guidelineTitle,
    rejectionReason: existing.rejectionReason ?? incoming.rejectionReason,
    issueDescription: existing.issueDescription ?? incoming.issueDescription,
    nextSteps: existing.nextSteps ?? incoming.nextSteps,
  };
}

function toEmailInput({ email, envelopeFrom, extraAuthenticationHeaders }: QueuedEmail) {
  return {
    subject: email.subject ?? "",
    fromAddress: email.from?.address ?? "",
    envelopeFrom,
    dateHeader: email.date ?? "",
    messageId: email.messageId ?? "",
    text: email.text ?? "",
    html: email.html ?? "",
    authenticationHeaders: [extraAuthenticationHeaders, authenticationHeaders(email)].filter(Boolean).join("\n"),
  };
}

function authenticationHeaders(email: Email): string {
  return email.headers
    .filter((header) => /^(?:authentication-results|arc-authentication-results)$/i.test(header.key))
    .map((header) => header.value)
    .join("\n");
}

function isAttachedEmail(attachment: Attachment): boolean {
  const mimeType = attachment.mimeType.toLowerCase();
  const filename = attachment.filename?.toLowerCase() ?? "";
  return (
    mimeType === "message/rfc822" ||
    mimeType === "message/global" ||
    mimeType === "application/eml" ||
    filename.endsWith(".eml")
  );
}

function attachmentSize(attachment: Attachment): number {
  if (typeof attachment.content === "string") {
    return new TextEncoder().encode(attachment.content).byteLength;
  }
  return attachment.content.byteLength;
}
