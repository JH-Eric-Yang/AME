import { defineConfig, devices } from "@playwright/test";
import { ChromiumMediaArgs } from "./e2e/fixtures/mediaFiles";

// Dedicated ports so the suite never attaches to another project's dev server.
const ClientPort = 5199;
const ClientUrl = `http://localhost:${ClientPort}`;
// Override when 3001 is held by another checkout's dev server; the spawned
// server must then be given the matching PORT and the client VITE_SERVER_URL.
const ServerUrl = process.env.E2E_SERVER_URL ?? "http://localhost:3001";

/**
 * End-to-end config. Boots the real Express server and SvelteKit client, so
 * Postgres and Redis must be running and migrations applied.
 */
export default defineConfig({
  testDir: "./e2e",
  // Makes the fake camera, microphone and stimulus files with ffmpeg.
  globalSetup: "./e2e/fixtures/globalSetup.ts",
  // The runner writes to a shared database, so keep runs serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: ClientUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera", "microphone"],
        launchOptions: {
          // Fake media devices, the pink-noise microphone and a fake sound output.
          args: ChromiumMediaArgs,
        },
      },
    },
    // `npm run tutorials`: records a captioned video and a step page for each
    // element in tutorial-output/. `npm run test:e2e` runs only "chromium".
    {
      name: "tutorial-setup",
      testMatch: /tutorials\/setup\.tutorial\.ts/,
      teardown: "tutorial-index",
    },
    {
      name: "tutorial",
      testMatch: /tutorials\/elements\.tutorial\.ts/,
      dependencies: ["tutorial-setup"],
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera", "microphone"],
        // A wrong label fails the tutorial in 15 s, not at the 3-minute test limit.
        actionTimeout: 15_000,
        launchOptions: {
          args: ChromiumMediaArgs,
          // Slow actions, so a viewer can follow them.
          slowMo: 120,
        },
      },
    },
    {
      name: "tutorial-index",
      testMatch: /tutorials\/index\.tutorial\.ts/,
    },
  ],

  webServer: [
    {
      command: "npm run dev --workspace server",
      url: `${ServerUrl}/api/experiment/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `npm run dev --workspace client -- --port ${ClientPort} --strictPort`,
      url: ClientUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
