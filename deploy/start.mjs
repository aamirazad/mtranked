// Container entrypoint: runs migrations and the idempotent seed, then supervises
// the API, the realtime server and Caddy in one container.
//
// - If any process dies, the others are stopped and the container exits non-zero
//   so Docker's restart policy brings the whole thing back.
// - On SIGTERM/SIGINT the realtime server drains races first (up to 150s) while
//   Caddy and the API keep serving; they are stopped once it has exited.
//
// Environment:
//   SITE_ADDRESS     Caddy site address. Defaults to DOMAIN (automatic HTTPS),
//                    or ":80" (plain HTTP, e.g. behind another proxy) when unset.
//   MIGRATE_ON_START "false" skips migrations and seeding.
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  API_PORT: process.env.API_PORT || "4001",
  REALTIME_PORT: process.env.REALTIME_PORT || "4002",
  SITE_ADDRESS: process.env.SITE_ADDRESS || process.env.DOMAIN || ":80",
};

const log = (msg) => console.log(`[start] ${msg}`);

/** Runs a one-off command to completion; exits the container if it fails. */
function runOnce(name, args) {
  return new Promise((resolve) => {
    const child = spawn("node", args, { stdio: "inherit", env });
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      log(`${name} failed (${signal ?? `exit ${code}`})`);
      process.exit(1);
    });
  });
}

/** @type {Map<string, import("node:child_process").ChildProcess>} */
const procs = new Map();
let stopping = false;
let exitCode = 0;

function start(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: "inherit", env });
  procs.set(name, child);
  child.on("exit", (code, signal) => {
    procs.delete(name);
    if (!stopping) {
      log(`${name} exited unexpectedly (${signal ?? `exit ${code}`}), stopping the container`);
      exitCode = 1;
      stop();
    } else if (name === "realtime") {
      // races are drained; the rest can go now
      for (const p of procs.values()) p.kill("SIGTERM");
    }
    if (procs.size === 0) process.exit(exitCode);
  });
}

function stop() {
  stopping = true;
  const realtime = procs.get("realtime");
  if (realtime) realtime.kill("SIGTERM");
  else for (const p of procs.values()) p.kill("SIGTERM");
}

let signals = 0;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (++signals > 1) {
      log(`${signal} again, killing everything`);
      for (const p of procs.values()) p.kill("SIGKILL");
      process.exit(1);
    }
    log(`${signal}: shutting down`);
    if (procs.size === 0) process.exit(0);
    stop();
  });
}

log(`MT Ranked ${env.MTR_VERSION ?? "dev"}`);
if (env.MIGRATE_ON_START !== "false") {
  await runOnce("migrate", ["packages/db/dist/migrate.js"]);
  await runOnce("seed", ["packages/db/dist/seed.js"]);
}
if (signals === 0) {
  start("api", "node", ["api/dist/index.js"]);
  start("realtime", "node", ["realtime/dist/index.js"]);
  start("caddy", "caddy", ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]);
}
