import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		timeout: 600000,
		env: {
			// files-server.test.ts / files-attachments.test.ts read from this
			// fixture directory (tests/fixtures/files) with known contents.
			HOLLAMA_FILES_DIR: resolve(import.meta.dirname, 'tests/fixtures/files'),
			// Isolate the data dir so a stray filesConfig.json (from a manual smoke
			// or another run) can't override HOLLAMA_FILES_DIR now that the files
			// routes read the live config. Kept empty → existing tests use the env
			// fixtures, and /api/files/config is 403 in web mode anyway.
			HOLLAMA_DATA_DIR: resolve(import.meta.dirname, 'tests/.tmp-data-web'),
			// Pin the env so hasServerApiKey=false regardless of the runner's
			// shell — otherwise an exported OPENAI_API_KEY hides the API-Key field
			// and the official/keyless tests fail with confusing symptoms.
			// PUBLIC_ADAPTER stays unset → web mode.
			OPENAI_API_KEY: ''
		}
	},
	testDir: 'tests',
	testMatch: /(.+\.)?(test|spec)\.[jt]s/,
	timeout: 30000,
	workers: process.env.CI ? 1 : undefined,
	retries: process.env.CI ? 2 : 0,
	use: {
		trace: 'retain-on-failure',
		contextOptions: {
			permissions: ['clipboard-write', 'clipboard-read']
		},
		viewport: { width: 1280, height: 1024 }
	},
	snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
	expect: {
		toMatchSnapshot: {
			maxDiffPixels: 900
		}
	}
};

export default config;
