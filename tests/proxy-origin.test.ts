import { expect, test } from '@playwright/test';

/**
 * HTTP integration tests for the proxy routes' origin gate.
 *
 * The `+server.ts` handlers import `$env/dynamic/*` virtual modules, which the
 * Playwright runner cannot resolve — so a route handler cannot be imported and
 * unit-called (see the `checkOrigin` unit tests in security.test.ts for the
 * pure-function coverage). Instead we prove the ROUTE WIRING against the real
 * preview server via `APIRequestContext` (a Node-side client that CAN set the
 * `Origin` header, unlike browser fetch).
 *
 * The preview runs in WEB mode (PUBLIC_ADAPTER unset), so this covers:
 *  - the cross-origin 403 gate on both proxy routes, and
 *  - the web-mode keyless 401 containment (no open relay without a key).
 * The desktop keyless-allowed path (isDesktop + loopback) is covered by the
 * unit tests (isKeylessProxyAllowed / isLoopbackUrl / buildUpstreamHeaders) and
 * the manual Electron smoke test.
 */

const BASE = 'http://localhost:4173';
const UPSTREAM = 'https://api.example.com/v1';

test.describe('proxy origin gate (/api/models, /api/chat)', () => {
	test('cross-origin GET /api/models → 403 (before any upstream call)', async ({ request }) => {
		const res = await request.get(`${BASE}/api/models?baseUrl=${encodeURIComponent(UPSTREAM)}`, {
			headers: { origin: 'https://evil.com' }
		});
		expect(res.status()).toBe(403);
	});

	test('cross-origin POST /api/chat → 403 (before body validation)', async ({ request }) => {
		const res = await request.post(`${BASE}/api/chat`, {
			headers: { origin: 'https://evil.com' },
			data: { baseUrl: UPSTREAM, model: 'x', messages: [{ role: 'user', content: 'hi' }] }
		});
		expect(res.status()).toBe(403);
	});

	test('same-origin GET /api/models passes checkOrigin (then 401s on no key)', async ({
		request
	}) => {
		// Origin matches the preview host → checkOrigin allows; with no key in web
		// mode it then 401s, proving it got PAST the origin gate.
		const res = await request.get(`${BASE}/api/models?baseUrl=${encodeURIComponent(UPSTREAM)}`, {
			headers: { origin: BASE }
		});
		expect(res.status()).not.toBe(403);
		expect(res.status()).toBe(401);
	});

	test('web-mode keyless GET /api/models (no key, no Origin) → 401 (no open relay)', async ({
		request
	}) => {
		// No Origin header and no key → web mode returns the hard 401. Locks the
		// "web/docker still require a key" guarantee (isKeylessProxyAllowed(false)).
		const res = await request.get(`${BASE}/api/models?baseUrl=${encodeURIComponent(UPSTREAM)}`);
		expect(res.status()).toBe(401);
		const body = await res.json();
		expect(body.error).toBe('No API key available');
	});

	// The malformed-Host → 400 path on the proxy route can't be driven over HTTP:
	// the HTTP client (undici/Playwright) forbids overriding the Host header. It is
	// covered by composition instead — the unit test `checkOrigin - origin check ›
	// malformed Host header returns 400` proves the 400, and the cross-origin 403
	// route tests above prove checkOrigin runs first on both routes.

	test('empty x-api-key header is treated as no key → 401 in web mode', async ({
		request
	}) => {
		// An explicitly-empty x-api-key is coerced to "no key" (not a blank Bearer),
		// so web mode returns the same hard 401 as a missing header — pins the
		// coercion at the route level.
		const res = await request.get(`${BASE}/api/models?baseUrl=${encodeURIComponent(UPSTREAM)}`, {
			headers: { 'x-api-key': '' }
		});
		expect(res.status()).toBe(401);
	});
});
