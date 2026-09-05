import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  forwardedFromAddress,
  isReviewRecipient,
} from "../src/index";

const projectUrl = new URL("../", import.meta.url);

describe("public timeline", () => {
  it("identifies manual and Gmail automatic forwarding sources", () => {
    expect(forwardedFromAddress({
      from: { address: "Developer@Example.com" },
      headers: [],
    }, "bounce@example.com")).toBe("developer@example.com");

    expect(forwardedFromAddress({
      from: { address: "no_reply@email.apple.com" },
      headers: [],
    }, "developer+caf_=apple=review.vg@gmail.com")).toBe("developer@gmail.com");
  });

  it("accepts every review.vg local part and rejects other domains", () => {
    expect(isReviewRecipient("apple@review.vg")).toBe(true);
    expect(isReviewRecipient("report@review.vg")).toBe(true);
    expect(isReviewRecipient("anything+review@REVIEW.VG")).toBe(true);
    expect(isReviewRecipient("apple@other.example")).toBe(false);
    expect(isReviewRecipient("@review.vg")).toBe(false);
  });

  it("builds a six-month timeline while retaining all history for leaderboards", async () => {
    const query = await readFile(new URL("scripts/public-reviews.sql", projectUrl), "utf8");

    expect(query).toContain("julianday('now', '-6 months')");
    expect(query).toContain("julianday('now', '-60 days')");
    expect(query).toContain("SELECT r.submission_id");
    expect(query).toContain("states.has_approved");
    expect(query).toContain("END AS in_timeline");
    expect(query).toContain("LEFT JOIN app_metadata AS metadata");
    expect(query).not.toContain("LIMIT 1000");
    expect(query).not.toContain("r.app_icon_url");
    for (const privateColumn of [
      "forwarded_from",
      "organization_uuid",
      "rejection_reason",
      "issue_description",
      "next_steps",
      "raw_email",
    ]) {
      expect(query).not.toContain(privateColumn);
    }
  });

  it("advertises apple@review.vg without exposing the former primary address", async () => {
    const [html, script, translations] = await Promise.all([
      readFile(new URL("public/index.html", projectUrl), "utf8"),
      readFile(new URL("public/app.js", projectUrl), "utf8"),
      readFile(new URL("public/i18n.js", projectUrl), "utf8"),
    ]);
    const publicFiles = `${html}\n${script}\n${translations}`;

    expect(publicFiles).toContain("apple@review.vg");
    expect(publicFiles).not.toContain("report@review.vg");
  });

  it("reveals the already-loaded app name without a second API request", async () => {
    const script = await readFile(new URL("public/app.js", projectUrl), "utf8");

    expect(script).not.toContain("/api/apps/");
    expect(script).not.toContain("/api/timeline");
    expect(script).not.toContain("fetch(");
    expect(script).toContain("window.ReviewData");
    expect(script).toContain("app.revealedName = app.knownName");
  });

  it("serves the prebuilt public snapshot before the Worker", async () => {
    const [config, packageSource, html] = await Promise.all([
      readFile(new URL("wrangler.jsonc", projectUrl), "utf8"),
      readFile(new URL("package.json", projectUrl), "utf8"),
      readFile(new URL("public/index.html", projectUrl), "utf8"),
    ]);

    expect(config).toContain('"run_worker_first": false');
    expect(config).not.toContain('"binding": "ASSETS"');
    expect(packageSource).toContain('"build:data": "node scripts/build-static-data.mjs"');
    expect(html).toContain('<script src="/review-data.js" defer></script>');
  });
});
