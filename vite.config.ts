import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: `http://localhost:${process.env.ATLAS_API_PORT ?? 8787}`, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // S7: fails the run if any test changed the public proofs/refusals/ folder.
    globalSetup: ["tests/tools/refusals-guard.ts"],
    // E3 review r2: many test files start real sandboxes (Node and, since E2, Python). With one worker per core, the
    // machine is so busy that tests timing real seconds fail at random. Half the cores keeps the suite steady.
    maxWorkers: "50%",
    // Tests that start several sandboxes in a row (a run, then a replay with its control) need more than the default
    // 5 s when the machine is busy; a test that times real speed asserts it itself.
    testTimeout: 20_000,
  },
});
