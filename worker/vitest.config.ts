// unit tests run in plain Node (vite.config.ts is the Worker build)
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
