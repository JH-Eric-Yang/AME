/**
 * The supplementary device screen is client-only, for the same reason the
 * experiment runner is: it renders through ElementRenderer, whose import chain
 * pulls in browser-only libraries (surveyjs-widgets touches `self` at module
 * scope, MediaPipe needs WASM), and it opens its own Socket.IO connection.
 * Server-rendering it returns a 500.
 */
export const ssr = false;
