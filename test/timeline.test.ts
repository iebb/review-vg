import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  forwardedFromAddress,
  getTimeline,
  isReviewRecipient,
} from "../src/index";

const projectUrl = new URL("../", import.meta.url);

interface FakeTimelineRow {
  submission_id: string;
  app_name: string | null;
  platform: string;
  app_store_id: string;
  app_icon_url: string | null;
  app_category: string | null;
  app_version: string;
  status: "issue" | "success";
  submitted_at: string;
  latest_event_at: string;
  guideline_code: string | null;
  guideline_title: string | null;
  rejection_reason?: string | null;
  issue_description?: string | null;
  forwarded_from?: string | null;
  has_approved: number;
}

function fakeEnvironment(rows: FakeTimelineRow[]) {
  let query = "";
  const env = {
    DB: {
      prepare(sql: string) {
        query = sql;
        return {
          async all() {
            return { results: rows };
          },
        };
      },
    },
  } as unknown as Pick<Env, "DB">;
  return { env, query: () => query };
}

describe("public timeline", () => {
  it("returns app names directly while keeping private review fields hidden", async () => {
    const fixture = fakeEnvironment([{
      submission_id: "11111111-2222-3333-4444-555555555555",
      app_name: "Private pre-release name",
      platform: "iOS",
      app_store_id: "1234567890",
      app_icon_url: null,
      app_category: null,
      app_version: "1.0",
      status: "issue",
      submitted_at: "2026-08-28T00:00:00.000Z",
      latest_event_at: "2026-08-28T01:00:00.000Z",
      guideline_code: "2.1",
      guideline_title: "Information Needed",
      rejection_reason: "Guideline 2.1\n\nIssue Description\nPrivate rejection details",
      issue_description: "Private rejection details",
      forwarded_from: "developer@example.com",
      has_approved: 0,
    }]);

    const response = await getTimeline(fixture.env);
    const body = await response.json() as { events: Array<Record<string, unknown>> };

    expect(body.events[0]).toMatchObject({
      appName: "Private pre-release name",
      hasApproved: false,
      appStoreId: "1234567890",
      appCategory: null,
      guidelineCode: "2.1",
      guidelineTitle: "Information Needed",
    });
    expect(JSON.stringify(body)).not.toContain("forwardedFrom");
    expect(JSON.stringify(body)).not.toContain("developer@example.com");
    expect(JSON.stringify(body)).not.toContain("rejectionReason");
    expect(JSON.stringify(body)).not.toContain("Issue Description");
    expect(JSON.stringify(body)).not.toContain("Private rejection details");
  });

  it("identifies manual and Gmail automatic forwarding sources", () => {
    expect(forwardedFromAddress({
      from: { address: "Developer@Example.com" },
      headers: [],
    }, "bounce@example.com")).toBe("developer@example.com");

    expect(forwardedFromAddress({
      from: { address: "no_reply@email.apple.com" },
      headers: [],
    }, "developer+caf_=report=review.vg@gmail.com")).toBe("developer@gmail.com");
  });

  it("accepts every review.vg local part and rejects other domains", () => {
    expect(isReviewRecipient("report@review.vg")).toBe(true);
    expect(isReviewRecipient("anything+review@REVIEW.VG")).toBe(true);
    expect(isReviewRecipient("report@other.example")).toBe(false);
    expect(isReviewRecipient("@review.vg")).toBe(false);
  });

  it("selects only apps submitted in the last 60 days and includes approval state", async () => {
    const fixture = fakeEnvironment([]);

    await getTimeline(fixture.env);

    expect(fixture.query()).toContain("julianday('now', '-60 days')");
    expect(fixture.query()).toContain("SELECT r.submission_id, r.app_name");
    expect(fixture.query()).toContain("eligible.has_approved");
  });

  it("reveals the already-loaded app name without a second API request", async () => {
    const script = await readFile(new URL("public/app.js", projectUrl), "utf8");

    expect(script).not.toContain("/api/apps/");
    expect(script).toContain("app.revealedName = app.knownName");
  });
});
