import { resolve } from "node:path";
import { defineConfig } from "vite";

// The preview only: the renderer has no build of its own; web/ will import it directly in phase 2.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  server: { fs: { allow: [resolve(import.meta.dirname, "..", "..")] } },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(import.meta.dirname, "index.html"), hero: resolve(import.meta.dirname, "hero.html") } },
  },
});
