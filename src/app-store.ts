const LOOKUP_ENDPOINT = "https://itunes.apple.com/lookup";
const MAX_LOOKUP_IDS = 50;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const LOOKUP_TIMEOUT_MS = 5_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchAppStoreIcons(
  appStoreIds: string[],
  fetcher: Fetcher = fetch,
): Promise<Map<string, string>> {
  const ids = [...new Set(appStoreIds)].filter(isAppStoreId).slice(0, MAX_LOOKUP_IDS);
  if (ids.length === 0) return new Map();

  const url = new URL(LOOKUP_ENDPOINT);
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("entity", "software");

  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("AppStoreLookupFailed");

  const body = await readBoundedText(response, MAX_RESPONSE_BYTES);
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new Error("AppStoreLookupInvalidResponse");
  }

  const requested = new Set(ids);
  const icons = new Map<string, string>();
  for (const result of parsed.results) {
    if (!isRecord(result)) continue;
    const id = typeof result.trackId === "number" || typeof result.trackId === "string"
      ? String(result.trackId)
      : "";
    if (!requested.has(id)) continue;
    if (result.kind !== "software" && result.kind !== "mac-software") continue;

    const candidates = [result.artworkUrl512, result.artworkUrl100, result.artworkUrl60];
    const icon = candidates.find((candidate): candidate is string => isTrustedArtworkUrl(candidate));
    if (icon) icons.set(id, icon);
  }
  return icons;
}

function isAppStoreId(value: string): boolean {
  return /^\d{6,20}$/.test(value);
}

function isTrustedArtworkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "mzstatic.com" || url.hostname.endsWith(".mzstatic.com"));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("AppStoreLookupResponseTooLarge");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("AppStoreLookupResponseTooLarge");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
