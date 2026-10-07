import { defineConfig } from "tsup";
// Production builds of the maintenance scripts (migrate, seed, season rollover).
export default defineConfig({
  entry: ["scripts/migrate.ts", "scripts/seed.ts", "scripts/season-rollover.ts", "scripts/make-moderator.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  noExternal: [/^@mtr\//],
  clean: true,
});
