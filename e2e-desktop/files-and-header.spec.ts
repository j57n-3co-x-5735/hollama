import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Real packaged-binary coverage, reusing the electron:build output (no extra
// vite build):
//   Item 3 — a UI-set source folder is served LIVE by the file routes.
//   Item 4 — the header search + copy/export buttons render for the non-Fireworks
//            providers the user named (Ollama AND LM Studio). Combined with the
//            code trace (no client Fireworks gate exists, and message persistence
//            is a single shared path in +page.svelte for every strategy), this
//            confirms the buttons are provider-independent — they are gated only
//            by session state, which the fix now renders unconditionally.
// Run: xvfb-run -a npm run test:electron

const APP_PATH = resolve(import.meta.dirname, '../dist/linux-unpacked/hollama');

let app: ElectronApplication;
let win: Page;
let tmpFilesDir: string | undefined;

test.beforeAll(async () => {
	app = await _electron.launch({
		executablePath: APP_PATH,
		args: ['--no-sandbox', `--user-data-dir=/tmp/hollama-e2e-files-${process.pid}`]
	});
	win = await app.firstWindow({ timeout: 60000 });
	await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
	await app?.close();
	if (tmpFilesDir) rmSync(tmpFilesDir, { recursive: true, force: true });
});

test('Item 3: a UI-set source folder is served live by the file routes (200, not 403)', async () => {
	tmpFilesDir = mkdtempSync(join(tmpdir(), 'hollama-e2e-src-'));
	writeFileSync(join(tmpFilesDir, 'note.txt'), 'served live');

	// POST the override from the real renderer (desktop route allows it).
	const posted = await win.evaluate(async (dir) => {
		const r = await fetch('/api/files/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ dirs: [dir] })
		});
		return { status: r.status, body: await r.json() };
	}, tmpFilesDir);
	expect(posted.status).toBe(200);
	expect(posted.body.ok).toBe(true);

	// The listing route serves the new root immediately — no restart, not 403.
	const listing = await win.evaluate(async () => {
		const r = await fetch('/api/files?root=0');
		return { status: r.status, body: await r.json() };
	});
	expect(listing.status).toBe(200);
	expect(listing.body.entries.map((e: { name: string }) => e.name)).toContain('note.txt');

	// The content route reads a file inside it — 200, not 403.
	const content = await win.evaluate(async () => {
		const r = await fetch('/api/files/content?root=0&rel=note.txt');
		return { status: r.status, text: await r.text() };
	});
	expect(content.status).toBe(200);
	expect(content.text).toContain('served live');

	// Clear the override so the profile is left clean.
	await win.evaluate(async () => {
		await fetch('/api/files/config', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ dirs: [] })
		});
	});
});

// The user reported the buttons appear "for fireworks" but "not for ollama or
// any other provider other than fireworks". Test BOTH non-Fireworks providers
// they named — a verified server + a session that already has messages — and
// assert the header buttons render for each.
for (const provider of [
	{ label: 'Ollama', connectionType: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
	{ label: 'LM Studio', connectionType: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' }
]) {
	test(`Item 4: search + copy/export render for a ${provider.label} session`, async () => {
		await win.evaluate((p) => {
			const now = new Date().toISOString();
			window.localStorage.setItem(
				'hollama-servers',
				JSON.stringify([
					{
						id: 'srv',
						baseUrl: p.baseUrl,
						connectionType: p.connectionType,
						isVerified: now,
						isEnabled: true,
						label: p.label
					}
				])
			);
			window.localStorage.setItem(
				'hollama-sessions',
				JSON.stringify([
					{
						id: 'sess',
						messages: [
							{ role: 'user', content: 'hi' },
							{ role: 'assistant', content: 'hello there' }
						],
						systemPrompt: { role: 'system', content: '' },
						systemPromptText: '',
						options: {},
						model: { name: 'a-model', serverId: 'srv' },
						updatedAt: now
					}
				])
			);
		}, provider);

		await win.goto('http://127.0.0.1:4173/sessions/sess');
		await win.waitForLoadState('domcontentloaded');

		await expect(win.getByTestId('session-search-toggle')).toBeVisible();
		await expect(win.getByTestId('session-copy-button')).toBeVisible();
	});
}
