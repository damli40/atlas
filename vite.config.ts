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
  },
});
