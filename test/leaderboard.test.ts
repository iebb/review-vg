import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

describe("review leaderboards", () => {
  it("keeps the top 20 entries in each ranking", async () => {
    const script = await readFile(new URL("public/app.js", projectUrl), "utf8");
    const translations = await readFile(new URL("public/i18n.js", projectUrl), "utf8");

    expect(script).toContain("return entries.slice(0, 20);");
    expect(script).not.toContain("return entries.slice(0, 5);");
    expect(translations).toContain('"leaderboard.intro": "Top 20 matching reviews');
    expect(translations).toContain("前 20 条审核");
    expect(translations).toContain("Las 20 revisiones");
    expect(translations).toContain("上位20件");
  });
});
