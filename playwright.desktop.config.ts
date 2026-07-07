import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

// Desktop-mode (PUBLIC_ADAPTER=electron-node) proxy-route integration config.
//
// The proxy routes' isDesktop branch — keyless loopback + checkOrigin as the
// sole gate — only runs in this mode; the default playwright.config.ts runs WEB
// mode (PUBLIC_ADAPTER unset) and explicitly defers the desktop path. This runs
// the REAL adapter-node server (build/index.js) with PUBLIC_ADAPTER=electron-node
// — exactly how electron/main.js forks it — and drives it via APIRequestContext.
//
// Kept as a separate config + testDir so the default suite stays web-only and
// doesn't pay a second build. Run: npm run test:desktop
const PORT = 4271;

const config: PlaywrightTestConfig = {
	webServer: {
		command: 'npm run build && node build/index.js',
		port: PORT,
		reuseExistingServer: false,
		timeout: 600000,
		env: {
			PUBLIC_ADAPTER: 'electron-node',
			PORT: String(PORT),
			HOST: '127.0.0.1',
			ORIGIN: `http://127.0.0.1:${PORT}`,
			// Isolate the data dir so the files-config test's persisted override
			// (filesConfig.json) is written to a scratch path, not the repo's
			// default <cwd>/.hollama. HOLLAMA_FILES_DIR is intentionally left unset
			// so ALLOWED_FILE_DIRS = [] — the files-config test exercises the
			// override-with-no-env case (the primary "no env var" scenario).
			HOLLAMA_DATA_DIR: resolve(import.meta.dirname, 'tests-desktop/.tmp-data'),
			// Pin empty so hasServerApiKey/env-key don't vary with the runner's shell.
			OPENAI_API_KEY: ''
		}
	},
	testDir: 'tests-desktop',
	testMatch: /.*\.test\.ts/,
	timeout: 30000,
	workers: 1,
	retries: 0,
	use: {
		trace: 'retain-on-failure'
	}
};

export default config;
