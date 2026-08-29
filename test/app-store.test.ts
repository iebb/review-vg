import { describe, expect, it, vi } from "vitest";
import { fetchAppStoreMetadata } from "../src/app-store";

describe("fetchAppStoreMetadata", () => {
  it("returns validated Apple artwork and primary categories for iOS and macOS apps", async () => {
    const fetcher = vi.fn(async () => Response.json({
      resultCount: 2,
      results: [
        {
          trackId: 6783830742,
          kind: "software",
          artworkUrl512: "https://is1-ssl.mzstatic.com/image/thumb/example/512x512bb.jpg",
          primaryGenreName: "Social Networking",
        },
        {
          trackId: 6776688229,
          kind: "mac-software",
          artworkUrl100: "https://is2-ssl.mzstatic.com/image/thumb/mac/100x100bb.png",
          primaryGenreName: "Utilities",
        },
      ],
    }));

    const metadata = await fetchAppStoreMetadata(["6783830742", "6776688229"], fetcher);

    expect(metadata.get("6783830742")).toEqual({
      iconUrl: "https://is1-ssl.mzstatic.com/image/thumb/example/512x512bb.jpg",
      category: "Social Networking",
    });
    expect(metadata.get("6776688229")).toEqual({
      iconUrl: "https://is2-ssl.mzstatic.com/image/thumb/mac/100x100bb.png",
      category: "Utilities",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("ignores untrusted artwork hosts and unrequested results", async () => {
    const fetcher = vi.fn(async () => Response.json({
      resultCount: 2,
      results: [
        {
          trackId: 6783830742,
          kind: "software",
          artworkUrl512: "https://example.com/icon.png",
          primaryGenreName: "  Photo   & Video  ",
        },
        { trackId: 9999999999, kind: "software", artworkUrl512: "https://is1-ssl.mzstatic.com/icon.png" },
      ],
    }));

    await expect(fetchAppStoreMetadata(["6783830742"], fetcher)).resolves.toEqual(new Map([
      ["6783830742", { iconUrl: null, category: "Photo & Video" }],
    ]));
  });

  it("does not call Apple when no valid app IDs are supplied", async () => {
    const fetcher = vi.fn();
    await expect(fetchAppStoreMetadata(["not-an-id"], fetcher)).resolves.toEqual(new Map());
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects oversized responses", async () => {
    const fetcher = vi.fn(async () => new Response("{}", {
      headers: { "content-length": String(1024 * 1024 + 1) },
    }));
    await expect(fetchAppStoreMetadata(["6783830742"], fetcher)).rejects.toThrow(
      "AppStoreLookupResponseTooLarge",
    );
  });
});
