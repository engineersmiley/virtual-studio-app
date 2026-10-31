import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    {
      name: "bundle-module-inventory",
      apply: "build",
      generateBundle(_options, bundle) {
        const modules = Object.fromEntries(
          Object.values(bundle)
            .filter((output) => output.type === "chunk")
            .map((chunk) => [
              chunk.fileName,
              Object.keys(chunk.modules).map((id) =>
                path.relative(import.meta.dirname, id).replaceAll("\\", "/"),
              ),
            ]),
        );
        this.emitFile({
          type: "asset",
          fileName: ".vite/chunk-modules.json",
          source: JSON.stringify(modules, null, 2),
        });
      },
    },
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    manifest: true,
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
