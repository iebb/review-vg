import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

describe("social sharing metadata", () => {
  it("publishes an absolute Open Graph image and Twitter large card", async () => {
    const html = await readFile(new URL("public/index.html", projectUrl), "utf8");

    expect(html).toContain('property="og:image" content="https://review.vg/og-image.png?v=20260829"');
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:image" content="https://review.vg/og-image.png?v=20260829"');
  });

  it("keeps the social image at exactly 1200 by 630 pixels", async () => {
    const png = await readFile(new URL("public/og-image.png", projectUrl));

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
