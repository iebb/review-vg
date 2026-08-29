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
    const worker = await readFile(new URL("src/index.ts", projectUrl), "utf8");
    const match = html.match(/<script>\n([\s\S]*?gtag\('config', 'G-JPGZDW16JY'\);\n\s*)<\/script>/);

    expect(match).not.toBeNull();
    const digest = createHash("sha256").update(match![1]).digest("base64");
    expect(worker).toContain(`'sha256-${digest}'`);
    expect(worker).not.toContain("'unsafe-inline'");
    expect(worker).toContain("https://www.googletagmanager.com");
    expect(worker).toContain("https://*.google-analytics.com");
    expect(worker).toContain("https://*.analytics.google.com");
  });
});
