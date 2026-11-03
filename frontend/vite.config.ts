import { sentrySvelteKit } from "@sentry/sveltekit/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// the Worker (api + realtime) in dev: `pnpm dev` runs it on this port (worker/vite.config.ts)
const worker = `localhost:${process.env.WORKER_PORT ?? 8787}`;
const api = `http://${worker}`;
const realtime = `ws://${worker}`;

const rootEnv = loadEnv("", "..", "PUBLIC_");

export default defineConfig({
  define: {
    __SOURCE_URL__: JSON.stringify(process.env.PUBLIC_SOURCE_URL ?? rootEnv.PUBLIC_SOURCE_URL ?? ""),
    __CONTACT_EMAIL__: JSON.stringify(process.env.PUBLIC_CONTACT_EMAIL ?? rootEnv.PUBLIC_CONTACT_EMAIL ?? ""),
    __SENTRY_DSN__: JSON.stringify(process.env.PUBLIC_SENTRY_DSN ?? rootEnv.PUBLIC_SENTRY_DSN ?? ""),
  },
  plugins: [
    sentrySvelteKit({
      org: "aamir-lv",
      project: "mtranked",
      // source maps are uploaded (then deleted from the build) only when a token is available
      autoUploadSourceMaps: !!process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { filesToDeleteAfterUpload: ["./build/**/*.map", "./.svelte-kit/output/**/*.map"] },
    }),
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
      },
      // a static SPA, served as the Worker's assets with index.html as the fallback
      adapter: adapter({ fallback: "index.html" }),
      // check _app/version.json for a new deploy every 5 minutes (and whenever the tab
      // regains focus); the layout switches to it on the next navigation
      version: { pollInterval: 5 * 60_000 },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/ws": { target: realtime, ws: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: api },
      "/ws": { target: realtime, ws: true },
    },
  },
});
