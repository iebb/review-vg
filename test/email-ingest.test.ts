import { describe, expect, it } from "vitest";
import { extractReviewsFromMime } from "../src/email-ingest";

const SUCCESS_ID = "11111111-2222-3333-4444-555555555555";
const ISSUE_ID = "66666666-7777-8888-9999-aaaaaaaaaaaa";

function appleReviewEmail(options: {
  appName: string;
  submissionId: string;
  organizationId: string;
  status: "issue" | "success";
  date: string;
}): string {
  const subject =
    options.status === "success"
      ? `Review of your ${options.appName} (iOS) submission is complete.`
      : `There's an issue with your ${options.appName} (iOS) submission.`;
  const reason =
    options.status === "issue"
      ? `<h3>Guideline 2.1 - Information Needed</h3>
         <b>Issue Description</b><p>More information is required.</p>
         <b>Next Steps</b><p>Reply with the requested details.</p>
         <b>Resources</b>`
      : "<p>Review completed successfully.</p>";

  return `From: App Store Connect <no_reply@email.apple.com>
To: developer@example.com
Subject: ${subject}
Date: ${options.date}
Message-ID: <${options.submissionId}@email.apple.com>
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

<p>Submitted: Aug 26, 2026 at 12:00 AM Pacific Daylight Time<br>
Submitted by: API Key<br>
Number of items submitted: 1<br>
Submission ID: ${options.submissionId}</p>
<h3>App Version</h3><p>1.0 for iOS</p>
${reason}
<a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/${options.organizationId}?targetUrl=/apps/1234567890/appstore/reviewsubmissions/details/${options.submissionId}">View</a>`;
}

function attach(rawEmail: string, filename: string): string {
  return `--review-batch
Content-Type: message/rfc822; name="${filename}"
Content-Disposition: attachment; filename="${filename}"

${rawEmail}
`;
}

describe("attached email ingestion", () => {
  it("parses multiple attached emails and removes duplicate events by submission ID", async () => {
    const success = appleReviewEmail({
      appName: "Open Review",
      submissionId: SUCCESS_ID,
      organizationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "success",
      date: "Wed, 26 Aug 2026 21:16:33 +0000",
    });
    const issue = appleReviewEmail({
      appName: "Review Notes",
      submissionId: ISSUE_ID,
      organizationId: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
      status: "issue",
      date: "Fri, 28 Aug 2026 15:14:24 +0000",
    });
    const outer = `From: Developer <developer@example.com>
To: report@review.vg
Subject: App review batch
Date: Sat, 29 Aug 2026 06:00:00 +0000
Message-ID: <batch@example.com>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="review-batch"

--review-batch
Content-Type: text/plain; charset=UTF-8

Attached review emails.
${attach(success, "success-one.eml")}${attach(success, "success-duplicate.eml")}${attach(issue, "issue.eml")}--review-batch--
`;

    const extracted = await extractReviewsFromMime(outer, "developer@example.com");

    expect(extracted.attachedEmailsSeen).toBe(3);
    expect(extracted.skippedAttachments).toBe(0);
    expect(extracted.reviews).toHaveLength(2);
    expect(extracted.reviews.map((review) => review.submissionId).sort()).toEqual(
      [SUCCESS_ID, ISSUE_ID].sort(),
    );
    expect(extracted.reviews.map((review) => review.organizationId).sort()).toEqual(
      ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"].sort(),
    );
    expect(extracted.reviews.every((review) => review.verification === "forwarded-email")).toBe(true);
    expect(extracted.reviews.every((review) => review.appVersion === "1.0")).toBe(true);
    expect(extracted.reviews.find((review) => review.status === "issue")?.rejectionReason).toContain(
      "Guideline 2.1 - Information Needed",
    );
  });
});
