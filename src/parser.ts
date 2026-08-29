export type ReviewStatus = "issue" | "success";

export interface EmailInput {
  subject: string;
  fromAddress: string;
  envelopeFrom: string;
  dateHeader: string;
  messageId: string;
  text: string;
  html: string;
  authenticationHeaders: string;
}

export interface ParsedReviewEmail {
  appName: string;
  platform: string;
  appVersion: string | null;
  submissionId: string;
  organizationId: string;
  appStoreId: string;
  status: ReviewStatus;
  submittedAt: string | null;
  issueAt: string | null;
  successfulAt: string | null;
  eventAt: string;
  submittedVia: string | null;
  guidelineCode: string | null;
  guidelineTitle: string | null;
  rejectionReason: string | null;
  issueDescription: string | null;
  nextSteps: string | null;
  messageId: string;
}

const ISSUE_SUBJECT = /There(?:'|’|&#39;)s an issue with your\s+(.+?)\s+\(([^)]+)\)\s+submission\.?/i;
const SUCCESS_SUBJECT = /Review of your\s+(.+?)\s+\(([^)]+)\)\s+submission is complete\.?/i;
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SUBMISSION_ID = new RegExp(`Submission ID:\\s*(${UUID_PATTERN})(?![0-9a-f-])`, "i");
const REVIEW_URL = new RegExp(
  `appstoreconnect\\.apple\\.com/olympus/v1/session/switchTo/(${UUID_PATTERN})\\?targetUrl=/apps/(\\d+)/(?:appstore|distribution)/reviewsubmissions/details/(${UUID_PATTERN})(?![0-9a-f-])`,
  "i",
);

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export function parseReviewEmail(input: EmailInput): ParsedReviewEmail | null {
  const htmlText = htmlToText(input.html);
  const plainText = htmlToText(input.text);
  const combined = normalizeWhitespace(`${input.subject}\n${plainText}\n${htmlText}`);
  const subjectMatch = findSubject(input.subject, combined);
  if (!subjectMatch) return null;

  const submissionId = combined.match(SUBMISSION_ID)?.[1]?.toLowerCase();
  if (!submissionId) return null;

  const reviewUrlMatch = decodeHtml(input.html).replace(/\s+/g, "").match(REVIEW_URL);
  if (!reviewUrlMatch) return null;
  if (reviewUrlMatch[3].toLowerCase() !== submissionId) return null;

  const eventAt = parseEventDate(input.dateHeader);
  if (!eventAt) return null;

  const submittedLabel = extractSubmittedTimestamp(combined);
  const submittedAt = submittedLabel ? parsePacificTimestamp(submittedLabel) : null;
  const status = subjectMatch.status;
  const guideline = status === "issue" ? extractGuideline(combined) : null;
  const topLevelApple = normalizeAddress(input.fromAddress) === "no_reply@email.apple.com";
  const embeddedApple = /(?:From:\s*)?App Store Connect\s*<no_reply@email\.apple\.com>/i.test(
    decodeHtml(`${input.text}\n${input.html}`),
  );

  if (!topLevelApple && !embeddedApple) return null;

  const issueDescription =
    status === "issue" ? extractSection(combined, "Issue Description", "Next Steps") : null;
  const nextSteps = status === "issue" ? extractSection(combined, "Next Steps", "Resources") : null;

  return {
    appName: subjectMatch.appName,
    platform: subjectMatch.platform,
    appVersion: extractAppVersion(combined, subjectMatch.platform),
    submissionId,
    organizationId: reviewUrlMatch[1].toLowerCase(),
    appStoreId: reviewUrlMatch[2],
    status,
    submittedAt,
    issueAt: status === "issue" ? eventAt : null,
    successfulAt: status === "success" ? eventAt : null,
    eventAt,
    submittedVia: extractLabel(combined, "Submitted by", ["Number of items submitted", "Submission ID"]),
    guidelineCode: guideline?.code ?? null,
    guidelineTitle: guideline?.title ?? null,
    rejectionReason: buildRejectionReason(guideline, issueDescription, nextSteps),
    issueDescription,
    nextSteps,
    messageId: input.messageId,
  };
}

function extractAppVersion(text: string, expectedPlatform: string): string | null {
  const match = text.match(/App Version\s+([^\s]{1,64})\s+for\s+([^\n]{1,32})/i);
  if (!match) return null;
  const version = cleanInline(match[1]);
  const platform = cleanInline(match[2]);
  if (!/^[0-9a-z][0-9a-z._+()-]{0,63}$/i.test(version)) return null;
  if (platform.toLowerCase() !== expectedPlatform.toLowerCase()) return null;
  return version;
}

function buildRejectionReason(
  guideline: { code: string; title: string } | null,
  issueDescription: string | null,
  nextSteps: string | null,
): string | null {
  const sections = [
    guideline ? `Guideline ${guideline.code} - ${guideline.title}` : null,
    issueDescription ? `Issue Description\n${issueDescription}` : null,
    nextSteps ? `Next Steps\n${nextSteps}` : null,
  ].filter((section): section is string => Boolean(section));
  return sections.length > 0 ? sections.join("\n\n") : null;
}

function findSubject(subject: string, combined: string):
  | { appName: string; platform: string; status: ReviewStatus }
  | null {
  const candidates = [subject.replace(/^(?:(?:fwd?|re):\s*)+/i, ""), combined];
  for (const candidate of candidates) {
    const issue = candidate.match(ISSUE_SUBJECT);
    if (issue) return { appName: cleanInline(issue[1]), platform: cleanInline(issue[2]), status: "issue" };
    const success = candidate.match(SUCCESS_SUBJECT);
    if (success) return { appName: cleanInline(success[1]), platform: cleanInline(success[2]), status: "success" };
  }
  return null;
}

function extractSubmittedTimestamp(text: string): string | null {
  const match = text.match(
    /Submitted:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s+[AP]M\s+Pacific\s+(?:Daylight|Standard)\s+Time)/i,
  );
  return match?.[1] ? cleanInline(match[1]) : null;
}

export function parsePacificTimestamp(value: string): string | null {
  const match = value.match(
    /^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+Pacific\s+(Daylight|Standard)\s+Time$/i,
  );
  if (!match) return null;
  const month = MONTHS[titleCase(match[1])];
  if (month === undefined) return null;

  let hour = Number(match[4]) % 12;
  if (match[6].toUpperCase() === "PM") hour += 12;
  const offsetHours = match[7].toLowerCase() === "daylight" ? 7 : 8;
  const utc = Date.UTC(Number(match[3]), month, Number(match[2]), hour + offsetHours, Number(match[5]));
  return new Date(utc).toISOString();
}

function parseEventDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function extractGuideline(text: string): { code: string; title: string } | null {
  const match = text.match(/Guideline\s+([0-9]+(?:\.[0-9]+)*(?:\([a-z]\))?)\s*-\s*([^\n]+)/i);
  if (!match) return null;
  return { code: cleanInline(match[1]), title: cleanInline(match[2]) };
}

function extractSection(text: string, start: string, end: string): string | null {
  const expression = new RegExp(`${escapeRegExp(start)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(end)}`, "i");
  const value = text.match(expression)?.[1];
  if (!value) return null;
  return cleanBlock(value).replace(/^[-–—:\s]+/, "") || null;
}

function extractLabel(text: string, label: string, nextLabels: string[]): string | null {
  const expression = new RegExp(
    `${escapeRegExp(label)}:\\s*([\\s\\S]*?)\\s*(?:${nextLabels.map(escapeRegExp).join("|")}):`,
    "i",
  );
  const value = text.match(expression)?.[1];
  return value ? cleanInline(value) : null;
}

function htmlToText(value: string): string {
  if (!value) return "";
  return decodeHtml(value)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanBlock(value: string): string {
  return normalizeWhitespace(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeAddress(value: string): string {
  const bracketed = value.match(/<([^>]+)>/)?.[1];
  return (bracketed ?? value).trim().toLowerCase();
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
