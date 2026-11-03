import { describe, expect, it } from "vitest";
import { address, formatMessage, smtpSend } from "./smtp";

const msg = {
  from: "MT Ranked <no-reply@mg.example.com>",
  to: "player@example.com",
  subject: "Verify your MT Ranked email",
  text: "Verify: https://example.com/verify?token=abc",
  html: "<p>Verify</p>\n.<b>dot line</b>",
};

/** A scripted SMTP server: answers each command with the next reply and records what it got. */
function fakeServer(replies: string[]) {
  const got: string[] = [];
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let push!: (s: string) => void;
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      push = (s) => c.enqueue(enc.encode(s));
    },
  });
  let inData = false;
  let pending = "";
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      pending += dec.decode(chunk);
      for (;;) {
        const end = inData ? pending.indexOf("\r\n.\r\n") : pending.indexOf("\r\n");
        if (end < 0) return;
        const unit = pending.slice(0, end);
        pending = pending.slice(end + (inData ? 5 : 2));
        got.push(unit);
        inData = unit === "DATA";
        push(replies.shift() ?? "500 unexpected\r\n");
      }
    },
  });
  push(replies.shift()!);
  return { socket: { readable, writable }, got };
}

describe("smtp", () => {
  it("extracts the bare address", () => {
    expect(address("MT Ranked <a@b.com>")).toBe("a@b.com");
    expect(address(" a@b.com ")).toBe("a@b.com");
  });

  it("formats a two-part message with base64 bodies", () => {
    const out = formatMessage(msg, new Date(Date.UTC(2026, 10, 2, 12)), "id1");
    expect(out).toContain("From: MT Ranked <no-reply@mg.example.com>\r\n");
    expect(out).toContain("Message-ID: <id1@mg.example.com>\r\n");
    expect(out).toContain("Date: Mon, 02 Nov 2026 12:00:00 +0000\r\n");
    expect(out).toContain(Buffer.from(msg.text).toString("base64"));
    expect(out.split("\r\n").every((l) => l.length <= 998)).toBe(true);
    expect(out.endsWith("--mtr-id1--")).toBe(true);
  });

  it("encodes non-ASCII headers and strips newlines", () => {
    const out = formatMessage({ ...msg, subject: "héllo\r\nBcc: x@y.z" }, new Date(), "id2");
    expect(out).toContain(`Subject: =?UTF-8?B?${Buffer.from("héllo Bcc: x@y.z").toString("base64")}?=`);
    expect(out).not.toContain("\r\nBcc:");
  });

  it("runs a full session", async () => {
    const { socket, got } = fakeServer([
      "220 hello\r\n",
      "250-smtp.example\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n",
      "235 ok\r\n",
      "250 ok\r\n",
      "250 ok\r\n",
      "354 go\r\n",
      "250 queued\r\n",
      "221 bye\r\n",
    ]);
    await smtpSend(socket, "user@mg.example.com", "pw", msg);
    expect(got.slice(0, 2)).toEqual(["EHLO mg.example.com", `AUTH PLAIN ${Buffer.from("\0user@mg.example.com\0pw").toString("base64")}`]);
    expect(got.slice(2, 5)).toEqual(["MAIL FROM:<no-reply@mg.example.com>", "RCPT TO:<player@example.com>", "DATA"]);
    expect(got[5]).toContain("Subject: Verify your MT Ranked email");
    expect(got[6]).toBe("QUIT");
  });

  it("throws on a rejected login", async () => {
    const { socket } = fakeServer(["220 hello\r\n", "250 ok\r\n", "535 bad credentials\r\n"]);
    await expect(smtpSend(socket, "u", "wrong", msg)).rejects.toThrow("smtp AUTH: 535 bad credentials");
  });
});
