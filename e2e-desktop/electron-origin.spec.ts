import { resolve } from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Definitive check: launch the REAL packaged binary, capture the actual
// renderer's location.origin, and make UN-MOCKED requests from that renderer to
// the app's own proxy routes — confirming checkOrigin does NOT 403 the real
// Chromium renderer's Origin. This is the one thing APIRequestContext can't do
// (it supplies the Origin itself rather than emitting the real webview's).
//
// Requires `npm run electron:build` first + a display. Run:
//   xvfb-run -a npm run test:electron

const APP_PATH = resolve(import.meta.dirname, '../dist/linux-unpacked/hollama');

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
	app = await _electron.launch({
		executablePath: APP_PATH,
		// Unique isolated userData so this never touches the user's real profile.
		args: ['--no-sandbox', `--user-data-dir=/tmp/hollama-electron-e2e-${process.pid}`]
	});
	win = await app.firstWindow({ timeout: 60000 });
	await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
	await app?.close();
});

test('the real renderer origin passes checkOrigin (un-mocked POST /api/chat not 403)', async () => {
	// The renderer must be the loopback origin the server binds.
	const origin = await win.evaluate(() => location.origin);
	expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

	// Un-mocked POST from the real renderer (POST always sends an Origin header).
	// Passing checkOrigin reaches the keyless-loopback fetch → 502 (dead upstream).
	const status = await win.evaluate(async () => {
		const r = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				baseUrl: 'http://127.0.0.1:9/v1',
				model: 'x',
				messages: [{ role: 'user', content: 'hi' }]
			})
		});
		return r.status;
	});
	expect(status, 'real renderer POST must not be 403 by checkOrigin').not.toBe(403);
	expect(status).toBe(502);
});

test('un-mocked GET /api/models from the real renderer is not 403', async () => {
	const status = await win.evaluate(async () => {
		const r = await fetch('/api/models?baseUrl=' + encodeURIComponent('http://127.0.0.1:9/v1'));
		return r.status;
	});
	expect(status).not.toBe(403);
	expect(status).toBe(502);
});
