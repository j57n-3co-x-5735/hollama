import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import dotenv from 'dotenv';

dotenv.config();

const adapterConfig = {
	routes: {
		include: ['/*'],
		exclude: ['<all>']
	}
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess({})],

	kit: {
		adapter: adapterNode(adapterConfig),
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'connect-src': ['self', 'http://localhost:*', 'http://127.0.0.1:*'],
				'img-src': ['self', 'data:'],
				'font-src': ['self'],
				'frame-src': ['none'],
				'object-src': ['none'],
				'base-uri': ['self']
			}
		},
		version: {
			name: process.env.npm_package_version
		},
		alias: {
			$i18n: 'src/i18n'
		}
	}
};

export default config;
