import type { PlaywrightTestConfig } from '@playwright/test';

// Standalone config for the REAL Ollama E2E test. Reuses the already-running
// `vite dev` server (no build, no webServer) to keep the machine light.
const config: PlaywrightTestConfig = {
	testDir: './e2e-real',
	testMatch: /.*\.spec\.ts/,
	timeout: 600_000,
	workers: 1,
	retries: 0,
	use: {
		baseURL: 'http://localhost:5173',
		trace: 'retain-on-failure',
		viewport: { width: 1280, height: 1024 },
		contextOptions: {
			permissions: ['clipboard-write', 'clipboard-read']
		}
	}
};

export default config;
