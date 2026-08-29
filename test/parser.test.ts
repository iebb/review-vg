import { describe, expect, it } from "vitest";
import { parsePacificTimestamp, parseReviewEmail, type EmailInput } from "../src/parser";

const base: EmailInput = {
  subject: "",
  fromAddress: "no_reply@email.apple.com",
  envelopeFrom: "no_reply@email.apple.com",
  dateHeader: "Wed, 26 Aug 2026 21:16:33 +0000 (GMT)",
  messageId: "<example@email.apple.com>",
  text: "",
  html: "",
  authenticationHeaders: "dkim=pass header.d=email.apple.com; dmarc=pass fromdomain=email.apple.com",
};

describe("parsePacificTimestamp", () => {
  it("converts PDT and PST to UTC", () => {
    expect(parsePacificTimestamp("Aug 26, 2026 at 12:00 AM Pacific Daylight Time")).toBe(
      "2026-08-26T07:00:00.000Z",
    );
    expect(parsePacificTimestamp("Jan 2, 2026 at 12:30 PM Pacific Standard Time")).toBe(
      "2026-01-02T20:30:00.000Z",
    );
  });
});

describe("parseReviewEmail", () => {
  it("parses a successful review with submitted and successful times", () => {
    const result = parseReviewEmail({
      ...base,
      subject: "Review of your Mithka (iOS) submission is complete.",
      text: "Submission ID: 6c88cc8c-96e0-495d-9a36-f88613be69a6\nApp Name: Mithka",
      html: `
        <p>Submitted: Aug 26, 2026 at 12:00 AM Pacific Daylight Time<br>
        Submitted by: API Key<br>Number of items submitted: 1<br>
        Submission ID: 6c88cc8c-96e0-495d-9a36-f88613be69a6</p>
        <h3>App Version</h3><p>1.2.6 for iOS</p>
        <a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/cbaca10a-f696-4d2b-959e-0d3fa1b23452?targetUrl=/apps/6783830742/appstore/reviewsubmissions/details/6c88cc8c-96e0-495d-9a36-f88613be69a6">View</a>`,
    });

    expect(result).toMatchObject({
      appName: "Mithka",
      platform: "iOS",
      appVersion: "1.2.6",
      status: "success",
      submittedAt: "2026-08-26T07:00:00.000Z",
      successfulAt: "2026-08-26T21:16:33.000Z",
      organizationId: "cbaca10a-f696-4d2b-959e-0d3fa1b23452",
      appStoreId: "6783830742",
      submittedVia: "API Key",
    });
  });

  it("parses guideline details from an issue email", () => {
    const result = parseReviewEmail({
      ...base,
      subject: "There's an issue with your Telisten (iOS) submission.",
      dateHeader: "Fri, 28 Aug 2026 15:14:24 +0000 (GMT)",
      messageId: "<issue@email.apple.com>",
      text: `
        Submission ID: 75deca1f-788c-4807-835b-2dbafca0740c
        <h3>Guideline 4.3(a) - Design - Spam</h3>
        <b>Issue Description</b>
        We noticed the app shares a similar binary, metadata, and/or concept.
        <b>Next Steps</b>
        Review the app concept and submit a unique app.
        <b>Resources</b>`,
      html: `<p>Submitted: Aug 27, 2026 at 08:05 PM Pacific Daylight Time<br>
        Submitted by: API Key<br>Submission ID: 75deca1f-788c-4807-835b-2dbafca0740c</p>
        <h3>App Version</h3><p>1.0.0 for iOS</p>
        <a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/cbaca10a-f696-4d2b-959e-0d3fa1b23452?targetUrl=/apps/6804541534/appstore/reviewsubmissions/details/75deca1f-788c-4807-835b-2dbafca0740c">View</a>`,
    });

    expect(result).toMatchObject({
      appName: "Telisten",
      appVersion: "1.0.0",
      status: "issue",
      submittedAt: "2026-08-28T03:05:00.000Z",
      issueAt: "2026-08-28T15:14:24.000Z",
      guidelineCode: "4.3(a)",
      guidelineTitle: "Design - Spam",
      rejectionReason:
        "Guideline 4.3(a) - Design - Spam\n\nIssue Description\nWe noticed the app shares a similar binary, metadata, and/or concept.\n\nNext Steps\nReview the app concept and submit a unique app.",
      issueDescription: "We noticed the app shares a similar binary, metadata, and/or concept.",
      nextSteps: "Review the app concept and submit a unique app.",
    });
  });

  it("stores an explicit fallback when Apple provides no detailed rejection reason", () => {
    const result = parseReviewEmail({
      ...base,
      subject: "There's an issue with your Example (iOS) submission.",
      text: "Submission ID: 11111111-2222-3333-4444-555555555555",
      html: `<a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?targetUrl=/apps/1234567890/appstore/reviewsubmissions/details/11111111-2222-3333-4444-555555555555">View</a>`,
    });

    expect(result?.rejectionReason).toBe(
      "Apple reported an issue with this submission but did not include a detailed rejection reason in the forwarded email.",
    );
  });

  it("accepts a manual forward", () => {
    const result = parseReviewEmail({
      ...base,
      subject: "Fwd: Review of your Example (macOS) submission is complete.",
      fromAddress: "developer@example.com",
      envelopeFrom: "developer@example.com",
      authenticationHeaders: "dkim=pass header.d=example.com",
      text: `From: App Store Connect <no_reply@email.apple.com>
        Submission ID: 11111111-2222-3333-4444-555555555555`,
      html: `<a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/cbaca10a-f696-4d2b-959e-0d3fa1b23452?targetUrl=/apps/1234567890/appstore/reviewsubmissions/details/11111111-2222-3333-4444-555555555555">View</a>`,
    });
    expect(result?.submissionId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("rejects unrelated email", () => {
    expect(parseReviewEmail({ ...base, subject: "Your invoice", text: "Hello" })).toBeNull();
  });

  it("accepts any valid organization UUID", () => {
    expect(
      parseReviewEmail({
        ...base,
        subject: "Review of your Example (iOS) submission is complete.",
        text: "Submission ID: 11111111-2222-3333-4444-555555555555",
        html: `<a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?targetUrl=/apps/1234567890/appstore/reviewsubmissions/details/11111111-2222-3333-4444-555555555555">View</a>`,
      }),
    ).toMatchObject({ organizationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
  });

  it("rejects a malformed organization identifier", () => {
    expect(
      parseReviewEmail({
        ...base,
        subject: "Review of your Example (iOS) submission is complete.",
        text: "Submission ID: 11111111-2222-3333-4444-555555555555",
        html: `<a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/------------------------------------?targetUrl=/apps/1234567890/appstore/reviewsubmissions/details/11111111-2222-3333-4444-555555555555">View</a>`,
      }),
    ).toBeNull();
  });

  it("rejects a message whose body and URL use different submission IDs", () => {
    expect(
      parseReviewEmail({
        ...base,
        subject: "Review of your Example (iOS) submission is complete.",
        text: "Submission ID: 11111111-2222-3333-4444-555555555555",
        html: `<a href="https://appstoreconnect.apple.com/olympus/v1/session/switchTo/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?targetUrl=/apps/1234567890/appstore/reviewsubmissions/details/99999999-2222-3333-4444-555555555555">View</a>`,
      }),
    ).toBeNull();
  });
});
