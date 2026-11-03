// Dev helper: a bot player that queues (or joins a room) and types at a set
// speed, so you can test races alone.
//   pnpm bot --mode ranked --wpm 70
//   pnpm bot --room ABC123 --wpm 90 --count 3
// Needs `pnpm dev` running: bots verify their accounts straight in the local D1 database.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import type { ServerMsg } from "@mtr/race-protocol";

const DB_ID = "636fb508-8220-41ec-a6c5-97d10c7c0c9a";
const port = process.env.WORKER_PORT ?? 8787;

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "casual" },
    wpm: { type: "string", default: "60" },
    name: { type: "string" },
    room: { type: "string" },
    count: { type: "string", default: "1" },
    api: { type: "string", default: `http://localhost:${port}` },
    ws: { type: "string", default: `ws://localhost:${port}/ws` },
    races: { type: "string", default: "1000" },
  },
});

async function account(name: string): Promise<string> {
  const email = `${name}@bots.local`;
  const body = JSON.stringify({ email, password: "botpassword", displayName: name });
  const h = { "content-type": "application/json" };
  let res = await fetch(`${values.api}/api/auth/login`, { method: "POST", headers: h, body });
  if (res.status !== 200) res = await fetch(`${values.api}/api/auth/signup`, { method: "POST", headers: h, body });
  if (res.status !== 200) throw new Error(`auth failed: ${await res.text()}`);
  // dev only: skip email verification and account age for bots
  const day2 = Date.now() - 2 * 86400_000;
  execFileSync(
    "pnpm",
    ["exec", "cf", "d1", "raw", DB_ID, "--local", "--persist-to", ".cloudflare/state", "--sql",
      `update users set email_verified_at = coalesce(email_verified_at, ${Date.now()}), created_at = min(created_at, ${day2}) where email = '${email.replace(/'/g, "''")}'`],
    { stdio: "ignore" },
  );
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function runBot(name: string, wpm: number) {
  const cookie = await account(name);
  const ticketRes = await fetch(`${values.api}/api/auth/ticket`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });
  const { ticket } = (await ticketRes.json()) as { ticket: string };
  const ws = new WebSocket(`${values.ws}?ticket=${ticket}`);
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  let racesLeft = Number(values.races);
  let timers: NodeJS.Timeout[] = [];
  const log = (...a: unknown[]) => console.log(`[${name}]`, ...a);

  ws.onopen = () => {
    // the server drops sockets that stay silent for minutes
    setInterval(() => send({ type: "ping", t: Date.now() }), 20_000);
    if (values.room) send({ type: "room.join", code: values.room });
    else send({ type: "queue.join", mode: values.mode });
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg;
    if (process.env.BOT_DEBUG) log(msg.type);
    switch (msg.type) {
      case "error":
        log("error:", msg.message);
        break;
      case "match.found":
        log(`match found vs ${msg.players.map((p) => p.name).join(" & ")}`);
        setTimeout(() => send({ type: "ready", matchId: msg.matchId }), 600 + Math.random() * 1000);
        break;
      case "race.countdown": {
        log(`race starting: ${msg.text.length} chars`);
        const mean = 12000 / wpm;
        let t = 0;
        let seq = 0;
        const keys: { k: string; t: number }[] = [];
        for (const ch of msg.text) {
          t += Math.max(20, mean * (0.6 + Math.random() * 0.8));
          keys.push({ k: ch, t: Math.round(t) });
        }
        const delay = msg.startAt - Date.now();
        let i = 0;
        const flush = () => {
          const now = Date.now() - msg.startAt;
          const batch: typeof keys = [];
          while (i < keys.length && keys[i]!.t <= now) batch.push(keys[i++]!);
          if (batch.length) send({ type: "input.batch", raceId: msg.raceId, seq: seq++, keys: batch });
          if (i >= keys.length) timers.forEach(clearInterval);
        };
        timers = [setTimeout(() => timers.push(setInterval(flush, 100)), Math.max(0, delay))];
        break;
      }
      case "race.result": {
        timers.forEach(clearInterval);
        const me = msg.results.find((r) => r.name === name);
        log(`result: #${me?.placement} ${me?.wpm} wpm ${me?.acc}% ${me?.delta !== undefined ? `(${me.delta >= 0 ? "+" : ""}${me.delta})` : ""}`);
        if (--racesLeft <= 0) process.exit(0);
        if (!values.room) setTimeout(() => send({ type: "queue.join", mode: values.mode }), 2500);
        break;
      }
      case "match.cancelled":
        log("match cancelled:", msg.reason);
        break;
    }
  };
  ws.onclose = (e) => {
    log("disconnected", e.code, e.reason);
    process.exit(1);
  };
}

const n = Number(values.count);
const baseWpm = Number(values.wpm);
for (let i = 0; i < n; i++) {
  const name = values.name ? (n > 1 ? `${values.name}${i + 1}` : values.name) : `bot_${baseWpm}_${i + 1}`;
  void runBot(name, baseWpm + (i * 7) % 20);
}
