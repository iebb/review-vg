import { describe, expect, it } from "vitest";
import { getTimeline } from "../src/index";

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
  rejection_reason: string | null;
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
  it("hides unapproved app names even if a database row contains one", async () => {
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
      rejection_reason: "Guideline 2.1",
      has_approved: 0,
    }]);

    const response = await getTimeline(fixture.env);
    const body = await response.json() as { events: Array<Record<string, unknown>> };

    expect(body.events[0]).toMatchObject({
      appName: null,
      appStoreId: "1234567890",
      appCategory: null,
    });
    expect(JSON.stringify(body)).not.toContain("Private pre-release name");
  });

  it("selects only apps submitted in the last 60 days and uses approved names", async () => {
    const fixture = fakeEnvironment([]);

    await getTimeline(fixture.env);

    expect(fixture.query()).toContain("julianday('now', '-60 days')");
    expect(fixture.query()).toContain("WHEN eligible.has_approved = 1");
    expect(fixture.query()).toContain("approved.status = 'success'");
  });
});
