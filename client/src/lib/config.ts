/**
 * Client-side runtime configuration.
 *
 * Single source of truth for the API server's origin. REST, Socket.IO and tus
 * uploads are all served by the same Express process, so they must agree on
 * one URL. Override with VITE_SERVER_URL when the server runs elsewhere.
 */

const DefaultServerUrl = "http://localhost:3001";

export const ServerUrl: string =
  import.meta.env.VITE_SERVER_URL ?? DefaultServerUrl;

/** Origin used by a supplementary device to reach the server over the LAN. */
export function deviceServerUrl(pageOrigin: string): string {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;

  const port = new URL(DefaultServerUrl).port;
  return pageOrigin.replace(/:\d+$/, `:${port}`);
}
