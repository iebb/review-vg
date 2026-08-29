import { describe, expect, it, vi } from "vitest";
import PostalMime from "postal-mime";
import { approveGmailForwarding, gmailForwardingConfirmationUrl } from "../src/gmail-forwarding";

const APPROVAL_URL =
  "https://mail-settings.google.com/mail/vf-test-confirmation-token-0123456789abcdef";

async function gmailMessage(
  link = APPROVAL_URL,
  from = "Gmail Team <forwarding-noreply@google.com>",
) {
  return PostalMime.parse(`From: ${from}
To: report@review.vg
Subject: (Gmail Forwarding Confirmation - Receive Mail from developer@gmail.com
Date: Sat, 29 Aug 2026 06:20:00 +0000
Message-ID: <forwarding-confirmation@mail.gmail.com>
Content-Type: text/html; charset=UTF-8

<p>To allow forwarding, click this link:</p><a href="${link}">${link}</a>`);
}

describe("Gmail forwarding confirmation", () => {
  it("extracts the vf approval link from authenticated Gmail sender shape", async () => {
    const url = gmailForwardingConfirmationUrl(
      await gmailMessage(),
      "forwarding-noreply@google.com",
    );
    expect(url?.toString()).toBe(APPROVAL_URL);
  });

  it("does not accept the cancellation link", async () => {
    const url = gmailForwardingConfirmationUrl(
      await gmailMessage(APPROVAL_URL.replace("/vf-", "/uf-")),
      "forwarding-noreply@google.com",
    );
    expect(url).toBeNull();
  });

  it("accepts Google's bounce envelope while requiring the exact visible sender", async () => {
    const url = gmailForwardingConfirmationUrl(
      await gmailMessage(),
      "forwarding-token@gaia.bounces.google.com",
    );
    expect(url?.toString()).toBe(APPROVAL_URL);
    expect(
      gmailForwardingConfirmationUrl(
        await gmailMessage(APPROVAL_URL, "Attacker <attacker@example.com>"),
        "forwarding-token@gaia.bounces.google.com",
      ),
    ).toBeNull();
  });

  it("accepts Gmail's direct mail.google.com vf link", async () => {
    const direct = APPROVAL_URL.replace("mail-settings.google.com", "mail.google.com");
    expect(
      gmailForwardingConfirmationUrl(await gmailMessage(direct), "bounce@google.com")?.toString(),
    ).toBe(direct);
  });

  it("loads the confirmation page and submits its empty confirmation POST", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: APPROVAL_URL.replace("mail-settings.google.com", "mail.google.com"),
            "set-cookie": "GMAIL_CONFIRM=session; Path=/; Secure; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          `<form method="POST" action="${APPROVAL_URL.replace("mail-settings.google.com", "mail.google.com")}"><input type="submit" value="Confirm"></form>`,
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          "<h1>Confirmation Success!</h1><p>The requester may now forward mail to the destination.</p>",
          { status: 200 },
        ),
      );
    await approveGmailForwarding(new URL(APPROVAL_URL), fetcher as typeof fetch);

    expect(fetcher).toHaveBeenNthCalledWith(1, new URL(APPROVAL_URL), {
      method: "GET",
      headers: expect.any(Headers),
      redirect: "manual",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL(APPROVAL_URL.replace("mail-settings.google.com", "mail.google.com")),
      {
        method: "GET",
        headers: expect.any(Headers),
        redirect: "manual",
      },
    );
    const postInit = fetcher.mock.calls[2]?.[1] as RequestInit;
    expect(fetcher.mock.calls[2]?.[0]).toEqual(
      new URL(APPROVAL_URL.replace("mail-settings.google.com", "mail.google.com")),
    );
    expect(postInit.method).toBe("POST");
    expect(postInit.body).toBe("");
    expect(postInit.redirect).toBe("manual");
    expect(new Headers(postInit.headers).get("cookie")).toBe("GMAIL_CONFIRM=session");
    expect(new Headers(postInit.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("refuses a confirmation-page redirect away from Google", async () => {
    const fetcher = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/collect" },
      }),
    );
    await expect(
      approveGmailForwarding(new URL(APPROVAL_URL), fetcher as typeof fetch),
    ).rejects.toThrow("invalid Gmail forwarding confirmation URL");
  });

  it("refuses a non-Google redirect after the confirmation POST", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          `<form method="POST" action="${APPROVAL_URL}"><input type="submit" value="Confirm"></form>`,
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example/collect" },
        }),
      );
    await expect(
      approveGmailForwarding(new URL(APPROVAL_URL), fetcher as typeof fetch),
    ).rejects.toThrow("non-Google Gmail confirmation redirect");
    expect(fetcher).toHaveBeenLastCalledWith(new URL(APPROVAL_URL), {
      method: "POST",
      headers: expect.any(Headers),
      body: "",
      redirect: "manual",
    });
  });

  it("does not POST when Gmail does not return the expected confirmation form", async () => {
    const fetcher = vi.fn(async () => new Response("Expired link", { status: 200 }));
    await expect(
      approveGmailForwarding(new URL(APPROVAL_URL), fetcher as typeof fetch),
    ).rejects.toThrow("did not contain the expected form");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not report approval for an HTTP 200 response without Gmail's success message", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          `<form method="POST" action="${APPROVAL_URL}"><input type="submit" value="Confirm"></form>`,
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("Please try again", { status: 200 }));
    await expect(
      approveGmailForwarding(new URL(APPROVAL_URL), fetcher as typeof fetch),
    ).rejects.toThrow("did not return a success page");
  });
});
