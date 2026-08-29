import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

describe("search metadata", () => {
  it("publishes descriptive, canonical, indexable page metadata", async () => {
    const html = await readFile(new URL("public/index.html", projectUrl), "utf8");
    const title = html.match(/<title>(.*?)<\/title>/)?.[1] || "";
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1] || "";

    expect(title).toBe("App Store Review Times &amp; Outcomes — Review.vg");
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(170);
    expect(html).toContain('<link rel="canonical" href="https://review.vg/"');
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large');
    expect(html).toContain('rel="sitemap" type="application/xml" href="https://review.vg/sitemap.xml"');
  });

  it("publishes valid and accurate WebSite JSON-LD", async () => {
    const html = await readFile(new URL("public/index.html", projectUrl), "utf8");
    const source = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];

    expect(source).toBeTruthy();
    const data = JSON.parse(source!);
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "https://review.vg/#website",
      url: "https://review.vg/",
      name: "Review.vg",
      isAccessibleForFree: true,
      inLanguage: ["en", "zh-CN", "es", "ja"],
    });
    expect(data.image).toMatchObject({ width: 1200, height: 630 });
  });

  it("exposes only the canonical page in the sitemap and keeps APIs out of search", async () => {
    const robots = await readFile(new URL("public/robots.txt", projectUrl), "utf8");
    const sitemap = await readFile(new URL("public/sitemap.xml", projectUrl), "utf8");

    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: https://review.vg/sitemap.xml");
    expect(sitemap.match(/<loc>/g)).toHaveLength(1);
    expect(sitemap).toContain("<loc>https://review.vg/</loc>");
  });
});
