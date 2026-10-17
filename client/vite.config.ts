import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Read the one .env in the repository root, shared with the server.
	// Vite exposes only the VITE_-prefixed values to the browser.
	envDir: '..'
});
