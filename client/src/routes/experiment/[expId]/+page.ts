/**
 * The experiment runner is client-only: it opens a Socket.IO connection,
 * reads localStorage, and mounts browser-only libraries (SurveyJS widgets,
 * MediaPipe). Server-rendering it fails, so render on the client alone.
 */
export const ssr = false;
