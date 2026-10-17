import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-node builds a Node server in build/; PM2 runs build/index.js in production.
		adapter: adapter()
	}
};

export default config;
