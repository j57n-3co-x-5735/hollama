import type { PlaywrightTestConfig } from '@playwright/test';

// Real packaged-Electron config. Launches dist/linux-unpacked/hollama and drives
// its actual Chromium renderer — the only test that exercises the REAL webview
// Origin against checkOrigin (APIRequestContext can't reproduce it). No webServer:
// the app forks its own SvelteKit server.
//
// Prerequisites: `npm run electron:build` (produces the binary) and a display —
// run headless with `xvfb-run -a npm run test:electron`. Kept out of the default
// suite because it needs the packaged binary + a display.
const config: PlaywrightTestConfig = {
	testDir: 'e2e-desktop',
	testMatch: /.*\.spec\.ts/,
	timeout: 120000,
	workers: 1,
	retries: 0,
	use: {
		trace: 'retain-on-failure'
	}
};

export default config;
