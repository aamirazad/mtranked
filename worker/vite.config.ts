import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  // the SvelteKit build is the Worker's static assets (build the frontend first: turbo does)
  publicDir: "../frontend/build",
  // keep local D1 and Durable Object state where `pnpm db:migrate` writes it
  plugins: [cloudflare({ persistState: { path: ".cloudflare/state" } })],
  server: { port: Number(process.env.WORKER_PORT ?? 8787), strictPort: true },
});
