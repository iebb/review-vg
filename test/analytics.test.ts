import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const projectUrl = new URL("../", import.meta.url);

describe("Google Analytics tag", () => {
  it("loads the requested GA4 measurement and initializes gtag", async () => {
    const html = await readFile(new URL("public/index.html", projectUrl), "utf8");

    expect(html).toContain(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-JPGZDW16JY"></script>',
    );
    expect(html).toContain("gtag('config', 'G-JPGZDW16JY');");
  });

  it("authorizes the exact inline initializer without unsafe-inline", async () => {
    const html = await readFile(new URL("public/index.html", projectUrl), "utf8");
    const headers = await readFile(new URL("public/_headers", projectUrl), "utf8");
    const match = html.match(/<script>\n([\s\S]*?gtag\('config', 'G-JPGZDW16JY'\);\n\s*)<\/script>/);

    expect(match).not.toBeNull();
    const digest = createHash("sha256").update(match![1]).digest("base64");
    expect(headers).toContain(`'sha256-${digest}'`);
    expect(headers).not.toContain("'unsafe-inline'");
    expect(headers).toContain("https://www.googletagmanager.com");
    expect(headers).toContain("https://*.google-analytics.com");
    expect(headers).toContain("https://*.analytics.google.com");
  });
});
