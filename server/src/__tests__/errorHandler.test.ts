import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { asyncHandler, errorHandler } from "../middleware/errorHandler.js";
import { useTestServer } from "./helpers/httpTestServer.js";

const app = express();
app.get(
  "/fails",
  asyncHandler(async () => {
    throw new Error("connection refused");
  }),
);
app.get(
  "/ok",
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  }),
);
app.get(
  "/fails-mid-stream",
  asyncHandler(async (_req, res) => {
    res.write("partial,");
    throw new Error("stream broke");
  }),
);
app.use(errorHandler);

const server = useTestServer(app);

describe("errorHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("asyncHandler", () => {
    it("answers 500 with the API error shape when an async handler rejects", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(server).get("/fails");

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ code: "INTERNAL", message: "Internal server error" });
      expect(log).toHaveBeenCalledWith("[HTTP] GET /fails failed:", expect.any(Error));
    });

    it("does not leak the error's message to the caller", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(server).get("/fails");

      expect(res.text).not.toContain("connection refused");
    });

    it("leaves a successful handler's response alone", async () => {
      const res = await request(server).get("/ok");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("keeps serving requests after a handler has failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      await request(server).get("/fails");
      const res = await request(server).get("/ok");

      expect(res.status).toBe(200);
    });
  });

  describe("after headers are sent", () => {
    it("aborts the response instead of writing a JSON body", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      const outcome = await request(server)
        .get("/fails-mid-stream")
        .then(
          (res) => res.text,
          (err: Error) => err,
        );

      // Express's default handler destroys the socket; either the client sees
      // an aborted connection or a truncated body, never the JSON error.
      if (typeof outcome === "string") {
        expect(outcome).not.toContain("INTERNAL");
      } else {
        expect(outcome).toBeInstanceOf(Error);
      }
    });
  });
});
