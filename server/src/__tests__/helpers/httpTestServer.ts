import http from "node:http";
import type { RequestListener, Server } from "node:http";
import { beforeAll, afterAll } from "vitest";

/**
 * One listening HTTP server for a whole test file, to be handed to supertest
 * in place of the bare Express app.
 *
 * Given an app rather than a server, supertest binds a fresh ephemeral port
 * with `app.listen(0)` and tears it down again for EVERY request. Across a
 * file of thirty-odd requests, multiplied by the other suites running in
 * parallel forks, that churn intermittently produced either a request that
 * never completed (a 5s test timeout) or a 404 the app had no route to emit.
 * The failure moved between tests and between files from run to run, which is
 * what identified it as transport rather than test state — mock resets and
 * per-test fixtures had nothing to do with it.
 *
 * The mechanism is ephemeral-port reuse across processes: fork A closes port
 * P, fork B's supertest binds the freed P for a different Express app, and an
 * in-flight connection still headed for A lands on B — whose router has no
 * matching route, hence a 404 that A's app could not possibly have emitted.
 * A request that arrives while P belongs to nobody simply hangs. Handed an
 * already-listening server, supertest reuses its address and binds nothing, so
 * no port is ever released mid-file.
 *
 * Registers the suite's own `beforeAll` / `afterAll`, so a caller only has to
 * hold on to the returned server.
 *
 * @param app the Express app (or any request listener) to serve.
 * @returns the server to pass to `request(...)`.
 */
export function useTestServer(app: RequestListener): Server {
  const server = http.createServer(app);

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    // Node's global agent keeps sockets alive, so close() alone can hang.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  return server;
}
