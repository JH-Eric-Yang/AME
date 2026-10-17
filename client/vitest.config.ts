import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
      "ame-shared": resolve(__dirname, "../shared/src"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
});
