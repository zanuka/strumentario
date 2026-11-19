import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Vue and Svelte fixtures (packages/widget/fixtures) mount the one web component from each framework.
  plugins: [
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "strumentario-page-widget" } } }),
    svelte({ hot: false }),
  ],
  resolve: {
    // Svelte 5 resolves its client runtime (mount, effects) only under the "browser" condition.
    conditions: ["browser"],
    alias: {
      "@strumentario/server": path.join(
        root,
        "packages/server/src/index.ts",
      ),
      "@strumentario/cli": path.join(root, "packages/cli/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/widget/fixtures/**/*.test.ts"],
    environment: "node",
  },
});
