import { describe, expect, it, vi } from "vitest";
import { fetchAppStoreMetadata } from "../src/app-store";
import { backfillApprovedAppMetadata } from "../src/index";

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

describe("backfillApprovedAppMetadata", () => {
  it("stores icon and category once in app metadata for approved apps", async () => {
    const updates: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        if (sql.includes("WITH approved_apps")) {
          return {
            async all() {
              return {
                results: [{
                  app_store_id: "6757540723",
                  app_icon_url: null,
                  app_category: null,
                }],
              };
            },
          };
        }
        return {
          bind(...bindings: unknown[]) {
            return { sql, bindings };
          },
        };
      },
      async batch(statements: Array<{ sql: string; bindings: unknown[] }>) {
        updates.push(...statements);
        return [];
      },
    } as unknown as D1Database;
    const fetcher = vi.fn(async () => Response.json({
      resultCount: 1,
      results: [{
        trackId: 6757540723,
        kind: "software",
        artworkUrl512: "https://is1-ssl.mzstatic.com/image/thumb/example/512x512bb.jpg",
        primaryGenreName: "Utilities",
      }],
    }));

    await expect(backfillApprovedAppMetadata(db, fetcher)).resolves.toEqual({
      appsChecked: 1,
      appsUpdated: 1,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("INSERT INTO app_metadata");
    expect(updates[0].bindings).toEqual([
      "6757540723",
      "https://is1-ssl.mzstatic.com/image/thumb/example/512x512bb.jpg",
      "Utilities",
    ]);
  });

  it("does not call Apple when every approved app already has metadata", async () => {
    const db = {
      prepare() {
        return { async all() { return { results: [] }; } };
      },
    } as unknown as D1Database;
    const fetcher = vi.fn();

    await expect(backfillApprovedAppMetadata(db, fetcher)).resolves.toEqual({
      appsChecked: 0,
      appsUpdated: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
