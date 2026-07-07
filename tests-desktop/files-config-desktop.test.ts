import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Desktop-mode (PUBLIC_ADAPTER=electron-node) integration for the live
// source-directory config. Drives the real adapter-node server via
// APIRequestContext. The desktop config leaves HOLLAMA_FILES_DIR unset, so this
// exercises the PRIMARY scenario: no env var, a UI-set override — the exact case
// that would 403 if the containment checks still read the load-time const.
// Run via: npm run test:desktop

const BASE = 'http://127.0.0.1:4271';

test.describe('desktop /api/files/config (live source-dir override)', () => {
	test.afterEach(async ({ request }) => {
		// Clear the override so it doesn't leak into sibling desktop tests.
		await request.post(`${BASE}/api/files/config`, { data: { dirs: [] } });
	});

	test('POST a dir → config reflects it AND both file routes serve it (200, not 403)', async ({
		request
	}) => {
		const srcDir = mkdtempSync(join(tmpdir(), 'hollama-cfg-'));
		writeFileSync(join(srcDir, 'hello.txt'), 'hello from the override');

		try {
			const post = await request.post(`${BASE}/api/files/config`, { data: { dirs: [srcDir] } });
			expect(post.status()).toBe(200);
			expect((await post.json()).ok).toBe(true);

			const get = await request.get(`${BASE}/api/files/config`);
			expect(get.status()).toBe(200);
			expect((await get.json()).source).toBe('override');

			// CROSS-ROUTE — the exact break the "convert only 3 of 9 sites" bug caused:
			// the listing route must serve the newly-configured root, not 403.
			const listing = await request.get(`${BASE}/api/files?root=0`);
			expect(listing.status(), 'listing the configured root must not 403').toBe(200);
			const names = (await listing.json()).entries.map((e: { name: string }) => e.name);
			expect(names).toContain('hello.txt');

			// CROSS-ROUTE — the content route must read a file inside it, not 403.
			const content = await request.get(`${BASE}/api/files/content?root=0&rel=hello.txt`);
			expect(content.status(), 'reading a file in the configured root must not 403').toBe(200);
			expect(await content.text()).toContain('hello from the override');
		} finally {
			rmSync(srcDir, { recursive: true, force: true });
		}
	});

	test('POST a non-existent path → 400 and no override stored', async ({ request }) => {
		const res = await request.post(`${BASE}/api/files/config`, {
			data: { dirs: ['/definitely/not/a/real/dir/xyz-9f2a'] }
		});
		expect(res.status()).toBe(400);

		// Config still reflects no override.
		const get = await request.get(`${BASE}/api/files/config`);
		expect((await get.json()).source).not.toBe('override');
	});

	test('containment still holds when the allowlist comes from a UI override (../ escape rejected)', async ({
		request
	}) => {
		const srcDir = mkdtempSync(join(tmpdir(), 'hollama-cfg-'));
		writeFileSync(join(srcDir, 'inside.txt'), 'inside');

		try {
			expect(
				(await request.post(`${BASE}/api/files/config`, { data: { dirs: [srcDir] } })).status()
			).toBe(200);

			// A file genuinely inside the override is served.
			const ok = await request.get(`${BASE}/api/files/content?root=0&rel=inside.txt`);
			expect(ok.status()).toBe(200);

			// A traversal OUT of the configured root must still be denied — the
			// containment check runs against the same per-request override snapshot
			// the resolver used, so swapping the allowlist source (env → override)
			// does not weaken validateFilePath.
			const escape = await request.get(
				`${BASE}/api/files/content?root=0&rel=${encodeURIComponent('../../../../../../etc/passwd')}`
			);
			expect(escape.status(), 'traversal out of the override root must not be served').not.toBe(
				200
			);
			expect([400, 403]).toContain(escape.status());

			// Same for the listing route.
			const listEscape = await request.get(
				`${BASE}/api/files?root=0&rel=${encodeURIComponent('../../..')}`
			);
			expect([400, 403]).toContain(listEscape.status());
		} finally {
			rmSync(srcDir, { recursive: true, force: true });
		}
	});
});
