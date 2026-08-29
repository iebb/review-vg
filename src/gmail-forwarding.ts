import type { Email } from "postal-mime";

const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";
const CONFIRMATION_SUBJECT = /^\s*(?:\(|\[)?Gmail Forwarding Confirmation\s*-\s*Receive Mail from\s+/i;
const CONFIRMATION_LINK = /https:\/\/(?:mail-settings|mail)\.google\.com\/mail\/vf-[^\s"'<>]+/gi;
const MAX_CONFIRMATION_REDIRECTS = 5;
const MAX_CONFIRMATION_PAGE_BYTES = 256 * 1024;
const CONFIRMATION_HOSTS = new Set(["mail-settings.google.com", "mail.google.com"]);

export function gmailForwardingConfirmationUrl(email: Email, _envelopeFrom: string): URL | null {
  if (normalizeAddress(email.from?.address ?? "") !== GMAIL_FORWARDING_SENDER) return null;
  if (!CONFIRMATION_SUBJECT.test(email.subject ?? "")) return null;

  const content = decodeHtml(`${email.text ?? ""}\n${email.html ?? ""}`);
  for (const match of content.matchAll(CONFIRMATION_LINK)) {
    const candidate = match[0].replace(/[).,;]+$/, "");
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        CONFIRMATION_HOSTS.has(url.hostname) &&
        url.pathname.startsWith("/mail/vf-")
      ) {
        return url;
      }
    } catch {
      // Ignore malformed links and keep looking for the exact Gmail confirmation URL.
    }
  }
  return null;
}

export async function approveGmailForwarding(
  url: URL,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  assertGmailConfirmationUrl(url);

  const cookies = new Map<string, string>();
  let confirmationPage = new URL(url);
  let confirmationAction: URL | null = null;

  for (let redirects = 0; redirects <= MAX_CONFIRMATION_REDIRECTS; redirects += 1) {
    const headers = cookieHeaders(cookies);
    const response = await fetcher(confirmationPage, {
      method: "GET",
      headers,
      redirect: "manual",
    });
    captureResponseCookies(response.headers, cookies);

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Gmail forwarding confirmation redirect had no location");
      const redirected = new URL(location, confirmationPage);
      assertGmailConfirmationUrl(redirected);
      confirmationPage = redirected;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Gmail forwarding confirmation page returned HTTP ${response.status}`);
    }
    const html = await boundedResponseText(response);
    confirmationAction = findConfirmationFormAction(html, confirmationPage);
    break;
  }

  if (!confirmationAction) {
    throw new Error("Gmail forwarding confirmation exceeded the redirect limit");
  }

  const postHeaders = cookieHeaders(cookies);
  postHeaders.set("Content-Type", "application/x-www-form-urlencoded");
  postHeaders.set("Origin", confirmationAction.origin);
  postHeaders.set("Referer", confirmationPage.toString());
  const response = await fetcher(confirmationAction, {
    method: "POST",
    headers: postHeaders,
    body: "",
    redirect: "manual",
  });
  const redirectLocation = response.headers.get("location");
  captureResponseCookies(response.headers, cookies);

  if (response.ok) {
    const resultHtml = await boundedResponseText(response);
    if (isConfirmationSuccess(resultHtml)) return;
    throw new Error("Gmail forwarding confirmation did not return a success page");
  }
  await response.body?.cancel();
  if (isRedirect(response.status) && redirectLocation) {
    assertGoogleResultUrl(new URL(redirectLocation, confirmationAction));
    throw new Error("Gmail forwarding confirmation redirected without a success page");
  }
  throw new Error(`Gmail forwarding confirmation POST returned HTTP ${response.status}`);
}

function isConfirmationSuccess(html: string): boolean {
  return /Confirmation\s+Success!/i.test(html) && /may\s+now\s+forward\s+mail\s+to/i.test(html);
}

function findConfirmationFormAction(html: string, pageUrl: URL): URL {
  for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attributes = form[1];
    const contents = form[2];
    const method = htmlAttribute(attributes, "method") ?? "GET";
    if (method.toUpperCase() !== "POST") continue;
    if (!/<(?:input|button)\b[^>]*(?:value\s*=\s*["']?confirm\b|>\s*confirm\b)/i.test(contents)) {
      continue;
    }

    const action = new URL(decodeHtml(htmlAttribute(attributes, "action") ?? ""), pageUrl);
    assertGmailConfirmationUrl(action);
    return action;
  }
  throw new Error("Gmail forwarding confirmation page did not contain the expected form");
}

function htmlAttribute(attributes: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (quoted) return quoted[2];
  return attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*([^\\s>]+)`, "i"))?.[1] ?? null;
}

async function boundedResponseText(response: Response): Promise<string> {
  const advertisedSize = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(advertisedSize) && advertisedSize > MAX_CONFIRMATION_PAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("Gmail forwarding confirmation page was too large");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_CONFIRMATION_PAGE_BYTES) {
    throw new Error("Gmail forwarding confirmation page was too large");
  }
  return new TextDecoder().decode(bytes);
}

function assertGmailConfirmationUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    !CONFIRMATION_HOSTS.has(url.hostname) ||
    !url.pathname.startsWith("/mail/vf-")
  ) {
    throw new Error("Refused an invalid Gmail forwarding confirmation URL");
  }
}

function assertGoogleResultUrl(url: URL): void {
  if (url.protocol !== "https:" || !CONFIRMATION_HOSTS.has(url.hostname)) {
    throw new Error("Refused a non-Google Gmail confirmation redirect");
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function cookieHeaders(cookies: Map<string, string>): Headers {
  const headers = new Headers();
  if (cookies.size > 0) {
    headers.set(
      "Cookie",
      [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  }
  return headers;
}

function captureResponseCookies(headers: Headers, cookies: Map<string, string>): void {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = getSetCookie?.call(headers) ?? splitSetCookie(headers.get("set-cookie"));
  for (const value of values) {
    const pair = value.match(/^\s*([^=;\s]+)=([^;]*)/);
    if (!pair) continue;
    if (/\bmax-age=0\b/i.test(value)) cookies.delete(pair[1]);
    else cookies.set(pair[1], pair[2]);
  }
}

function splitSetCookie(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
}

function normalizeAddress(value: string): string {
  const bracketed = value.match(/<([^>]+)>/)?.[1];
  return (bracketed ?? value).trim().toLowerCase();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&quot;/gi, '"');
}
