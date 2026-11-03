// A minimal SMTP client: AUTH PLAIN over an already-encrypted socket (port 465), one message
// per connection. Takes the socket as a pair of streams so it runs anywhere; mail.ts opens it
// with cloudflare:sockets.

export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export interface SmtpMessage {
  from: string; // "Name <addr>" or a bare address
  to: string;
  subject: string;
  text: string;
  html: string;
}

const enc = new TextEncoder();

function base64(s: string) {
  let bin = "";
  for (const b of enc.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The bare address inside "Name <addr>". */
export const address = (s: string) => /<([^>]+)>/.exec(s)?.[1] ?? s.trim();

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(s)}?=`);

/** The message as RFC 5322 text: multipart/alternative, both parts base64 (no long lines). */
export function formatMessage(m: SmtpMessage, date = new Date(), id = crypto.randomUUID()) {
  const boundary = `mtr-${id}`;
  const from = oneLine(m.from);
  const name = /^(.*?)\s*</.exec(from)?.[1];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      "Content-Transfer-Encoding: base64",
      "",
      ...(base64(body).match(/.{1,76}/g) ?? []),
    ].join("\r\n");
  return [
    `From: ${name ? `${header(name)} <${address(from)}>` : from}`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${header(oneLine(m.subject))}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${address(from).split("@")[1]}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", m.text),
    part("text/html", m.html),
    `--${boundary}--`,
  ].join("\r\n");
}

/** Run one SMTP session on `socket`: authenticate, send `m`, quit. Throws on any unexpected reply. */
export async function smtpSend(socket: SmtpSocket, user: string, password: string, m: SmtpMessage) {
  const reader = socket.readable.pipeThrough(new TextDecoderStream()).getReader();
  const writer = socket.writable.getWriter();
  let buf = "";

  // one reply, possibly multi-line ("250-..." lines then "250 ...")
  async function reply(expect: number, step: string) {
    for (;;) {
      let nl: number;
      while ((nl = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (line[3] === "-") continue;
        const code = Number(line.slice(0, 3));
        if (code !== expect) throw new Error(`smtp ${step}: ${line.slice(0, 300)}`);
        return;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`smtp ${step}: connection closed`);
      buf += value;
    }
  }
  const send = (line: string) => writer.write(enc.encode(`${line}\r\n`));

  try {
    await reply(220, "greeting");
    await send(`EHLO ${address(m.from).split("@")[1]}`);
    await reply(250, "EHLO");
    await send(`AUTH PLAIN ${base64(`\0${user}\0${password}`)}`);
    await reply(235, "AUTH");
    await send(`MAIL FROM:<${address(m.from)}>`);
    await reply(250, "MAIL FROM");
    await send(`RCPT TO:<${address(m.to)}>`);
    await reply(250, "RCPT TO");
    await send("DATA");
    await reply(354, "DATA");
    // dot-stuffing: a line starting with "." gets a second one
    await send(`${formatMessage(m).replace(/^\./gm, "..")}\r\n.`);
    await reply(250, "message");
    await send("QUIT");
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}
