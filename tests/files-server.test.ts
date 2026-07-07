import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

// The webServer is started with HOLLAMA_FILES_DIR pointing at
// tests/fixtures/files (see playwright.config.ts). Fixture contents:
//   notes.txt          — plain text
//   subdir/nested.txt   — plain text, one level deep
//   image.png           — binary (PNG header + null bytes)
//   .hidden             — dotfile, must be excluded from listings
// The escape-link symlink is NOT a static fixture — symlinks don't reliably
// survive git checkouts/transfers across all platforms and tools, so the
// symlink-escape test below creates and removes its own.
const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'files');
const OUTSIDE_DIR = join(import.meta.dirname, 'fixtures', 'files-outside');

async function apiFetch(page: Page, path: string): Promise<{ status: number; body: unknown }> {
	return page.evaluate(async (p) => {
		const response = await fetch(p);
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			body = await response.text().catch(() => undefined);
		}
		return { status: response.status, body };
	}, path);
}

test.describe('Files server route', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('GET /api/files with no params returns roots as basename + index, never absolute paths', async ({
		page
	}) => {
		const { status, body } = await apiFetch(page, '/api/files');
		expect(status).toBe(200);
		const roots = (body as { roots: { name: string; index: number }[] }).roots;
		// Basename + index only — the absolute fixture path must NOT be disclosed.
		expect(roots.some((r) => r.name === 'files' && r.index === 0)).toBe(true);
		expect(JSON.stringify(roots)).not.toContain(FIXTURES_DIR);
	});

	test('navigates by root index + relative path (no absolute paths from the client)', async ({
		page
	}) => {
		// List the root by index.
		const rootListing = await apiFetch(page, '/api/files?root=0');
		expect(rootListing.status).toBe(200);
		const rootNames = (rootListing.body as { entries: { name: string }[] }).entries.map(
			(e) => e.name
		);
		expect(rootNames).toContain('notes.txt');
		expect(rootNames).toContain('subdir');

		// List a nested subdir by root index + rel.
		const nested = await apiFetch(page, '/api/files?root=0&rel=subdir');
		expect(nested.status).toBe(200);
		expect((nested.body as { entries: { name: string }[] }).entries.map((e) => e.name)).toContain(
			'nested.txt'
		);

		// Read content by root index + rel.
		const text = await page.evaluate(
			async (p) => (await fetch(p)).text(),
			'/api/files/content?root=0&rel=notes.txt'
		);
		expect(text).toContain('test fixture file');
	});

	test('rejects an out-of-range root index', async ({ page }) => {
		const { status } = await apiFetch(page, '/api/files?root=99');
		expect(status).toBe(403);
	});

	test('root + rel that escapes the root is contained (rejected)', async ({ page }) => {
		const { status } = await apiFetch(
			page,
			`/api/files/content?root=0&rel=${encodeURIComponent('../../etc/passwd')}`
		);
		expect(status).toBeGreaterThanOrEqual(400);
		expect(status).toBeLessThan(500);
	});

	test('lists a directory and excludes dotfiles', async ({ page }) => {
		const { status, body } = await apiFetch(
			page,
			`/api/files?dir=${encodeURIComponent(FIXTURES_DIR)}`
		);
		expect(status).toBe(200);
		const entries = (body as { entries: { name: string; type: string }[] }).entries;
		const names = entries.map((e) => e.name);
		expect(names).toContain('notes.txt');
		expect(names).toContain('subdir');
		expect(names).not.toContain('.hidden');
	});

	test('lists a nested subdirectory', async ({ page }) => {
		const { status, body } = await apiFetch(
			page,
			`/api/files?dir=${encodeURIComponent(join(FIXTURES_DIR, 'subdir'))}`
		);
		expect(status).toBe(200);
		const entries = (body as { entries: { name: string }[] }).entries;
		expect(entries.map((e) => e.name)).toContain('nested.txt');
	});

	test('returns file content with text/plain content type', async ({ page }) => {
		const path = join(FIXTURES_DIR, 'notes.txt');
		const { status } = await apiFetch(page, `/api/files/content?path=${encodeURIComponent(path)}`);
		expect(status).toBe(200);

		const result = await page.evaluate(async (p) => {
			const response = await fetch(p);
			return { contentType: response.headers.get('content-type'), text: await response.text() };
		}, `/api/files/content?path=${encodeURIComponent(path)}`);
		expect(result.contentType).toContain('text/plain');
		expect(result.text).toContain('test fixture file');
	});

	test('reads nested file content fresh from disk', async ({ page }) => {
		const path = join(FIXTURES_DIR, 'subdir', 'nested.txt');
		const text = await page.evaluate(
			async (p) => (await fetch(p)).text(),
			`/api/files/content?path=${encodeURIComponent(path)}`
		);
		expect(text).toContain('Nested fixture content');
	});

	test('rejects a binary file with 415', async ({ page }) => {
		const path = join(FIXTURES_DIR, 'image.png');
		const { status, body } = await apiFetch(
			page,
			`/api/files/content?path=${encodeURIComponent(path)}`
		);
		expect(status).toBe(415);
		expect((body as { error: string }).error).toContain('Binary');
	});

	test('rejects a missing dir/path query param with 400', async ({ page }) => {
		const listing = await apiFetch(page, '/api/files/content');
		expect(listing.status).toBe(400);
	});

	test.describe('path traversal rejection (OWASP vectors)', () => {
		// Each vector is sent RAW — deliberately NOT path.join'd onto FIXTURES_DIR,
		// which Node would normalize before the request even leaves the browser
		// (collapsing `../` and hiding it from the server). Sending the literal
		// string is what actually exercises the pre-resolve pattern-rejection
		// layers (3 = traversal regex, 4 = absolute-path requirement, 4.5 =
		// lexical containment) these vectors are named for. Each asserts the
		// exact status the corresponding layer produces, not just "some 4xx".
		const rawVectors: { path: string; label: string; expectStatus: number }[] = [
			{ path: '../../../etc/shadow', label: 'relative dot-dot traversal', expectStatus: 400 },
			{ path: '..\\..\\etc\\hosts', label: 'backslash traversal', expectStatus: 400 },
			{ path: '%2e%2e%2fetc%2fpasswd', label: 'url-encoded traversal', expectStatus: 400 },
			{
				path: '/etc/passwd',
				label: 'absolute path to a sensitive file outside the allowlist',
				expectStatus: 403
			},
			{ path: 'relative/path.txt', label: 'relative path (no leading slash)', expectStatus: 400 },
			{ path: '', label: 'empty path', expectStatus: 400 }
		];

		for (const { path, label, expectStatus } of rawVectors) {
			test(`rejects ${label}: ${path || '(empty)'}`, async ({ page }) => {
				const { status } = await apiFetch(
					page,
					`/api/files/content?path=${encodeURIComponent(path)}`
				);
				expect(status).toBe(expectStatus);
				// Never a 5xx (crash) and never a 2xx (an actual read).
				expect(status).toBeGreaterThanOrEqual(400);
				expect(status).toBeLessThan(500);
			});
		}

		test('does not reveal existence of arbitrary host files (no 404/403 oracle)', async ({
			page
		}) => {
			// An existing out-of-tree file and a nonexistent one must be
			// indistinguishable — otherwise a caller could probe the host
			// filesystem by watching for 403 (exists) vs 404 (missing). The
			// lexical containment pre-check makes both a uniform 403 'Access
			// denied' before realpathSync ever runs.
			const existing = await apiFetch(page, '/api/files/content?path=%2Fetc%2Fpasswd');
			const missing = await apiFetch(
				page,
				'/api/files/content?path=%2Fetc%2Fhollama-does-not-exist-xyz'
			);
			expect(existing.status).toBe(403);
			expect(missing.status).toBe(403);
			expect(existing.body).toEqual(missing.body);
		});

		test('does not serve a dotfile by direct path (content route)', async ({ page }) => {
			// The listing route hides .hidden; the content route must not serve it
			// by direct path either (this is where .env / .ssh keys would leak).
			const path = join(FIXTURES_DIR, '.hidden');
			const { status, body } = await apiFetch(
				page,
				`/api/files/content?path=${encodeURIComponent(path)}`
			);
			expect(status).toBe(403);
			expect((body as { error: string }).error).toBe('Access denied');
		});

		test.describe('symlink escape', () => {
			const escapeLinkPath = join(FIXTURES_DIR, 'escape-link');

			test.beforeAll(() => {
				symlinkSync(OUTSIDE_DIR, escapeLinkPath);
			});

			test.afterAll(() => {
				rmSync(escapeLinkPath, { force: true });
			});

			test('rejects a symlink that escapes the allowed directory', async ({ page }) => {
				const path = join(escapeLinkPath, 'secret.txt');
				const { status, body } = await apiFetch(
					page,
					`/api/files/content?path=${encodeURIComponent(path)}`
				);
				expect(status).toBe(403);
				expect((body as { error: string }).error).toBe('Access denied');
			});
		});

		test('rejects a sibling directory whose name merely starts with the allowed dir name', async ({
			page
		}) => {
			const path = `${FIXTURES_DIR}-evil/file.txt`;
			const { status } = await apiFetch(page, `/api/files/content?path=${encodeURIComponent(path)}`);
			expect(status).toBeGreaterThanOrEqual(400);
		});
	});

	test.describe('size limit', () => {
		const largePath = join(FIXTURES_DIR, 'oversized.txt');

		test.beforeAll(() => {
			writeFileSync(largePath, 'x'.repeat(11 * 1024 * 1024));
		});

		test.afterAll(() => {
			rmSync(largePath, { force: true });
		});

		test('rejects a file over 10MB with 413', async ({ page }) => {
			const { status, body } = await apiFetch(
				page,
				`/api/files/content?path=${encodeURIComponent(largePath)}`
			);
			expect(status).toBe(413);
			expect((body as { error: string }).error).toBe('File too large');
		});
	});

	test.describe('depth limit', () => {
		const deepDir = join(FIXTURES_DIR, ...Array(11).fill('d'));

		test.beforeAll(() => {
			mkdirSync(deepDir, { recursive: true });
		});

		test.afterAll(() => {
			rmSync(join(FIXTURES_DIR, 'd'), { recursive: true, force: true });
		});

		test('rejects a directory listing more than 10 levels below the allowed root', async ({
			page
		}) => {
			const { status } = await apiFetch(page, `/api/files?dir=${encodeURIComponent(deepDir)}`);
			expect(status).toBe(403);
		});
	});

	test('directory listing rejects a file path (not a directory)', async ({ page }) => {
		const path = join(FIXTURES_DIR, 'notes.txt');
		const { status, body } = await apiFetch(page, `/api/files?dir=${encodeURIComponent(path)}`);
		expect(status).toBe(400);
		expect((body as { error: string }).error).toBe('Path is not a directory');
	});

	test('content endpoint rejects a directory path (not a file)', async ({ page }) => {
		const { status, body } = await apiFetch(
			page,
			`/api/files/content?path=${encodeURIComponent(FIXTURES_DIR)}`
		);
		expect(status).toBe(400);
		expect((body as { error: string }).error).toBe('Path is not a file');
	});
});
