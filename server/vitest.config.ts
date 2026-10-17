import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Mock implementations and call history are cleared before every test, so
    // no suite can rely on state a previous test happened to leave behind.
    mockReset: true,
    coverage: {
      provider: "v8",
    },
  },
});
