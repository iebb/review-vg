import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

describe("review leaderboards", () => {
  it("keeps the all-history top 10 entries in each ranking", async () => {
    const script = await readFile(new URL("public/app.js", projectUrl), "utf8");
    const translations = await readFile(new URL("public/i18n.js", projectUrl), "utf8");

    expect(script).toContain("return entries.slice(0, 10);");
    expect(script).not.toContain("return entries.slice(0, 5);");
    expect(translations).toContain('"leaderboard.intro": "Top 10 matching reviews from all recorded history');
    expect(translations).toContain("全部历史记录");
    expect(translations).toContain("Las 10 revisiones coincidentes de todo el historial");
    expect(translations).toContain("全期間の記録");
    expect(script).toContain("data.leaderboardEvents");
  });

  it("uses equal-height rows and leaves unapproved names unlined", async () => {
    const styles = await readFile(new URL("public/styles.css", projectUrl), "utf8");
    const rowRule = styles.match(/\.review-leaderboard-entry \{([^}]*)\}/)?.[1] || "";
    const revealRule = styles.match(/\.app-name-reveal-label \{([^}]*)\}/)?.[1] || "";

    expect(rowRule).toContain("height: 78px");
    expect(rowRule).toContain("box-sizing: border-box");
    expect(revealRule).toContain("border: 0");
    expect(revealRule).not.toContain("border-bottom");
  });
});
