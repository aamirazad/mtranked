// Fail fast before `pnpm dev` if Postgres or Redis isn't reachable, instead of
// letting api and realtime retry forever and flood the terminal with errors.
import { existsSync } from "node:fs";
import { connect } from "node:net";

if (existsSync(".env")) process.loadEnvFile(".env");

const services = [
  ["Postgres", process.env.DATABASE_URL ?? "postgres://mtr:mtr@localhost:5433/mtr", 5432],
  ["Redis", process.env.REDIS_URL ?? "redis://localhost:6380", 6379],
];

const reachable = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2000 });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });

const down = [];
for (const [name, url, defaultPort] of services) {
  const { hostname, port } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!(await reachable(host, Number(port || defaultPort)))) down.push(`${name} (${host}:${port || defaultPort})`);
}

if (down.length) {
  console.error(`\nCan't reach ${down.join(" or ")}.\nStart the dev services with \`pnpm services:up\`, then run \`pnpm dev\` again.\n`);
  process.exit(1);
}
