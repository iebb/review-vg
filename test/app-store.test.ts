import { describe, expect, it, vi } from "vitest";
import { fetchAppStoreIcons } from "../src/app-store";

describe("fetchAppStoreIcons", () => {
  it("returns validated Apple artwork for iOS and macOS apps", async () => {
    const fetcher = vi.fn(async () => Response.json({
      resultCount: 2,
      results: [
        {
          trackId: 6783830742,
          kind: "software",
          artworkUrl512: "https://is1-ssl.mzstatic.com/image/thumb/example/512x512bb.jpg",
        },
        {
          trackId: 6776688229,
          kind: "mac-software",
          artworkUrl100: "https://is2-ssl.mzstatic.com/image/thumb/mac/100x100bb.png",
        },
      ],
    }));

    const icons = await fetchAppStoreIcons(["6783830742", "6776688229"], fetcher);

    expect(icons.get("6783830742")).toContain("512x512bb.jpg");
    expect(icons.get("6776688229")).toContain("100x100bb.png");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("ignores untrusted artwork hosts and unrequested results", async () => {
    const fetcher = vi.fn(async () => Response.json({
      resultCount: 2,
      results: [
        { trackId: 6783830742, kind: "software", artworkUrl512: "https://example.com/icon.png" },
        { trackId: 9999999999, kind: "software", artworkUrl512: "https://is1-ssl.mzstatic.com/icon.png" },
      ],
    }));

    await expect(fetchAppStoreIcons(["6783830742"], fetcher)).resolves.toEqual(new Map());
  });

  it("does not call Apple when no valid app IDs are supplied", async () => {
    const fetcher = vi.fn();
    await expect(fetchAppStoreIcons(["not-an-id"], fetcher)).resolves.toEqual(new Map());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized responses", async () => {
    const fetcher = vi.fn(async () => new Response("{}", {
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));
    await expect(fetchAppStoreIcons(["6783830742"], fetcher)).rejects.toThrow(
      "AppStoreLookupResponseTooLarge",
    );
  });
});
