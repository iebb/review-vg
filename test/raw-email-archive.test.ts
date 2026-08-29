import { describe, expect, it } from "vitest";
import { archiveIncomingEmail, purgeRawEmails } from "../src/index";

interface CapturedStatement {
  sql: string;
  values: unknown[];
  bind(...values: unknown[]): CapturedStatement;
}

function fakeDatabase() {
  const batches: CapturedStatement[][] = [];
  const db = {
    prepare(sql: string): CapturedStatement {
      return {
        sql,
        values: [],
        bind(...values: unknown[]) {
          this.values = values;
          return this;
        },
      };
    },
    async batch(statements: CapturedStatement[]) {
      batches.push(statements);
      return [];
    },
  } as unknown as D1Database;
  return { db, batches };
}

describe("private raw email archive", () => {
  it("chunks exact MIME bytes and enforces seven days plus a 1000-message cap", async () => {
    const fixture = fakeDatabase();
    const raw = new Uint8Array(1_500_001);
    raw[0] = 17;
    raw[raw.length - 1] = 29;

    const id = await archiveIncomingEmail(fixture.db, raw.buffer, {
      envelopeFrom: "sender@example.com",
      envelopeTo: "anything@review.vg",
      messageId: "<message@example.com>",
      subject: "Review result",
    });

    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.batches).toHaveLength(1);
    const statements = fixture.batches[0];
    const metadata = statements.find((statement) => statement.sql.includes("INSERT OR IGNORE INTO raw_emails"));
    const chunks = statements.filter((statement) => statement.sql.includes("INSERT OR IGNORE INTO raw_email_chunks"));
    const cap = statements.find((statement) => statement.sql.includes("LIMIT -1 OFFSET"));

    expect(metadata?.values[7]).toBe(raw.byteLength);
    expect(metadata?.values[8]).toBe(2);
    expect(chunks).toHaveLength(2);
    expect((chunks[0].values[2] as Uint8Array).byteLength).toBe(1_500_000);
    expect((chunks[1].values[2] as Uint8Array).byteLength).toBe(1);
    expect((chunks[0].values[2] as Uint8Array)[0]).toBe(17);
    expect((chunks[1].values[2] as Uint8Array)[0]).toBe(29);
    expect(cap?.sql).toContain("OFFSET 1000");

    const receivedAt = Date.parse(String(metadata?.values[1]));
    const expiresAt = Date.parse(String(metadata?.values[2]));
    expect(expiresAt - receivedAt).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("purges expired and over-cap messages without reading their private bodies", async () => {
    const fixture = fakeDatabase();

    await purgeRawEmails(fixture.db);

    expect(fixture.batches[0]).toHaveLength(2);
    expect(fixture.batches[0][0].sql).toContain("julianday(expires_at) <= julianday('now')");
    expect(fixture.batches[0][1].sql).toContain("OFFSET 1000");
    expect(fixture.batches[0].every((statement) => !statement.sql.includes("raw_chunk"))).toBe(true);
  });
});
