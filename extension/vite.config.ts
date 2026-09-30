import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(root, "popup.html"),
        background: resolve(root, "src/background.ts"),
        bridge: resolve(root, "src/bridge.ts"),
        provider: resolve(root, "src/provider.ts"),
      },
      output: {
        entryFileNames: (chunk) => ["background", "bridge", "provider"].includes(chunk.name) ? "[name].js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
