import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

describe("site typography", () => {
  it("never declares text smaller than 11px", async () => {
    const css = await readFile(new URL("public/styles.css", projectUrl), "utf8");
    const declaredPixels = [
      ...[...css.matchAll(/font-size:\s*([0-9.]+)px/gi)].map((match) => Number(match[1])),
      ...[...css.matchAll(/font:\s*[^;{}]*?([0-9.]+)px\//gi)].map((match) => Number(match[1])),
    ];

    expect(declaredPixels.length).toBeGreaterThan(0);
    expect(Math.min(...declaredPixels)).toBeGreaterThanOrEqual(11);
  });
});
