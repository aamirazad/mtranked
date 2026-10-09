import { sentrySvelteKit } from "@sentry/sveltekit/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const api = `http://localhost:${process.env.API_PORT ?? 4001}`;
const realtime = `ws://localhost:${process.env.REALTIME_PORT ?? 4002}`;

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
      project: "javascript-sveltekit",
      // source maps are uploaded (then deleted from the build) only when a token is available
      autoUploadSourceMaps: !!process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { filesToDeleteAfterUpload: ["./build/**/*.map", "./.svelte-kit/output/**/*.map"] },
    }),
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
      },
      // a static SPA: serve build/ from any CDN with 200.html as the fallback
      adapter: adapter({ fallback: "200.html" }),
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
