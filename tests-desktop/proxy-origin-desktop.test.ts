import { expect, test } from '@playwright/test';

// Desktop-mode (PUBLIC_ADAPTER=electron-node) proxy-route integration. Drives the
// real adapter-node server (build/index.js) via APIRequestContext, proving the
// isDesktop paths the web-mode proxy-origin.test.ts explicitly defers to unit
// tests. Run via: npm run test:desktop (playwright.desktop.config.ts).

const BASE = 'http://127.0.0.1:4271';
const DEAD_LOOPBACK = 'http://127.0.0.1:9/v1'; // loopback, nothing listening → 502 on fetch
const REMOTE = 'https://api.example.com/v1';

test.describe('desktop proxy origin gate', () => {
	test('Electron-style same-origin (127.0.0.1) passes checkOrigin → 502, not 403', async ({
		request
	}) => {
		// The packaged renderer loads http://127.0.0.1:<port> and its fetches carry
		// Origin+Host = 127.0.0.1:<port> — the same pair asserted here. Passing the
		// gate reaches the keyless-loopback fetch, which fails 502 (dead upstream).
		const res = await request.get(
			`${BASE}/api/models?baseUrl=${encodeURIComponent(DEAD_LOOPBACK)}`,
			{
				headers: { origin: BASE }
			}
		);
		expect(res.status(), 'Electron same-origin must not be 403').not.toBe(403);
		expect(res.status()).toBe(502);
	});

	test('only a host-form mismatch (localhost vs 127.0.0.1) is 403', async ({
		request
	}) => {
		// Documents the single failure mode. The app never hits it — it uses
		// 127.0.0.1 for both loadURL and the server bind.
		const res = await request.get(
			`${BASE}/api/models?baseUrl=${encodeURIComponent(DEAD_LOOPBACK)}`,
			{
				headers: { origin: 'http://localhost:4271' }
			}
		);
		expect(res.status()).toBe(403);
	});

	test('no-Origin + loopback baseUrl → keyless allowed → 502, not 401/403', async ({
		request
	}) => {
		const res = await request.get(
			`${BASE}/api/models?baseUrl=${encodeURIComponent(DEAD_LOOPBACK)}`
		);
		expect(res.status(), 'desktop keyless loopback must not 401/403').toBe(502);
	});

	test('empty x-api-key + remote baseUrl → 400 with add-a-key guidance', async ({
		request
	}) => {
		const res = await request.get(`${BASE}/api/models?baseUrl=${encodeURIComponent(REMOTE)}`, {
			headers: { 'x-api-key': '' }
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.error).toContain('add an API key for remote servers');
	});
});
