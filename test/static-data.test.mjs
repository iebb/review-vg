import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildStaticData,
  createPublicSnapshot,
  serializeSnapshot,
} from "../scripts/build-static-data.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

function reviewRow(overrides = {}) {
  return {
    submission_id: "11111111-2222-4333-8444-555555555555",
    app_name: "Before Approval",
    platform: "visionOS",
    app_store_id: "1234567890",
    app_icon_url: "https://is1-ssl.mzstatic.com/image/thumb/example/100x100bb.jpg",
    app_category: "Utilities",
    app_version: "1.0",
    status: "issue",
    submitted_at: "2026-08-28T00:00:00.000Z",
    latest_event_at: "2026-08-28T01:00:00.000Z",
    guideline_code: "2.1",
    guideline_title: "Information Needed",
    has_approved: 0,
    in_timeline: 1,
    forwarded_from: "developer@example.com",
    organization_uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    rejection_reason: "Private rejection detail",
    issue_description: "Private issue detail",
    next_steps: "Private next steps",
    raw_email: "Private raw MIME",
    ...overrides,
  };
}

describe("daily static review data", () => {
  it("publishes only the public projection and keeps all-history events separate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "review-vg-static-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "d1.json");
    const output = join(directory, "review-data.js");
    await writeFile(input, JSON.stringify([{
      success: true,
      results: [
        reviewRow(),
        reviewRow({
          submission_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          app_name: "Approved App",
          platform: "tvOS",
          status: "success",
          submitted_at: "2025-01-01T00:00:00.000Z",
          latest_event_at: "2025-01-01T02:00:00.000Z",
          guideline_code: "4.3",
          guideline_title: "Design Spam",
          has_approved: 1,
          in_timeline: 0,
        }),
      ],
    }]), "utf8");

    await buildStaticData({ input, local: false, output });
    const source = await readFile(output, "utf8");
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const snapshot = JSON.parse(JSON.stringify(context.window.ReviewData));

    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.leaderboardEvents).toHaveLength(2);
    expect(snapshot.events[0]).toMatchObject({
      appName: "Before Approval",
      platform: "visionOS",
      guidelineCode: "2.1",
      guidelineTitle: "Information Needed",
    });
    expect(snapshot.leaderboardEvents[1]).toMatchObject({
      platform: "tvOS",
      status: "success",
      guidelineCode: null,
      guidelineTitle: null,
    });
    for (const privateValue of [
      "developer@example.com",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "Private rejection detail",
      "Private issue detail",
      "Private next steps",
      "Private raw MIME",
    ]) {
      expect(source).not.toContain(privateValue);
    }
  });

  it("fails closed for empty or duplicate data", () => {
    expect(() => createPublicSnapshot([])).toThrow("Refusing to publish an empty review snapshot");
    expect(() => createPublicSnapshot([reviewRow(), reviewRow()])).toThrow("Duplicate submission_id");
  });

  it("escapes markup-significant characters in the JavaScript asset", () => {
    const snapshot = createPublicSnapshot([
      reviewRow({ app_name: "</script><script>alert(1)</script>" }),
    ], "2026-09-05T00:00:00.000Z");
    const source = serializeSnapshot(snapshot);

    expect(source).not.toContain("</script>");
    expect(source).toContain("\\u003c/script>");
  });
});
