import { expect, test } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

// This suite verifies correctness at scale (500 sessions render/search/delete,
// byte-cap behavior). The §6 performance BUDGETS themselves are verified in
// tests/perf/perf-budgets.mjs — a node microbenchmark that isolates the
// dominant computation, which a Playwright wall-clock cannot (its round-trip
// overhead swamps a 5ms budget). The timing asserts below are deliberately
// loose smoke guards against a hung/broken render, NOT budget checks; the
// console.log lines report the round-trip-inclusive numbers for context only.

interface MockSession {
	id: string;
	messages: { role: 'user' | 'assistant'; content: string; images?: { data: string; filename: string }[] }[];
	systemPrompt: { role: 'system'; content: string };
	systemPromptText: string;
	options: Record<string, never>;
	model: { name: string; serverId: string };
	updatedAt: string;
	title?: string;
	folderId?: string;
}

function makeSession(index: number, overrides: Partial<MockSession> = {}): MockSession {
	return {
		id: `stress-${index.toString().padStart(4, '0')}`,
		messages: [
			{ role: 'user', content: `Test question number ${index} about various topics` },
			{ role: 'assistant', content: `Test answer number ${index} with a reasonably long response body to approximate realistic session size in bytes.` }
		],
		systemPrompt: { role: 'system', content: '' },
		systemPromptText: '',
		options: {},
		model: { name: 'gemma:7b', serverId: 'stress-server' },
		updatedAt: new Date(Date.now() - index * 1000).toISOString(),
		...overrides
	};
}

// A ~50KB base64 blob is enough to make each session noticeably larger
// without actually needing a real image — the storage measurement only
// cares about serialized byte size, not image validity.
const FAKE_IMAGE_DATA = 'A'.repeat(50 * 1024);

function makeImageHeavySession(index: number): MockSession {
	const session = makeSession(index);
	session.messages[0].images = [{ data: FAKE_IMAGE_DATA, filename: `photo-${index}.png` }];
	return session;
}

async function seedSessions(page: import('@playwright/test').Page, sessions: MockSession[]) {
	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		sessions
	);
	await page.reload();
}

const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

/** Seeds image-heavy sessions until serialized usage is deterministically in
 * the block zone: past the 95% cap but under 100% (so the byte-cap logic
 * blocks, rather than the browser throwing a raw QuotaExceededError first).
 * Session content is pure ASCII, so JSON.stringify(...).length equals the
 * UTF-8 byte count getStorageUsageBytes() measures via Blob — the ratio the
 * app sees matches the ratio computed here. Returns the seeded count. */
async function seedOverBlockThreshold(page: import('@playwright/test').Page): Promise<number> {
	const sessions: MockSession[] = [];
	let i = 0;
	// 96% target: safely over the 95% block threshold, ~4% under the real quota.
	while (JSON.stringify(sessions).length < 0.96 * STORAGE_LIMIT_BYTES) {
		sessions.push(makeImageHeavySession(i++));
	}
	await seedSessions(page, sessions);
	return sessions.length;
}

test.describe('Storage capacity at scale', () => {
	test.setTimeout(30000);

	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
	});

	test('renders 500 unfiled sessions and folders correctly', async ({ page }) => {
		const sessions = Array.from({ length: 500 }, (_, i) => makeSession(i));
		const folders = [
			{ id: 'folder-a', name: 'Folder A', isExpanded: true, sortOrder: 0, updatedAt: new Date().toISOString() }
		];
		await page.evaluate(
			(data) => window.localStorage.setItem('hollama-folders', JSON.stringify(data)),
			folders
		);

		const renderStart = Date.now();
		await seedSessions(page, sessions);
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await expect(page.getByTestId('session-item')).toHaveCount(500);
		const renderMs = Date.now() - renderStart;
		console.log(`[stress] 500-session render (incl. reload+navigation): ${renderMs}ms`);
		// Generous smoke-test bound — includes full page reload, not just the
		// render itself. The <100ms DOM-paint budget applies to the paint
		// step in isolation and needs profiling tools to verify precisely;
		// this assertion only catches a genuinely broken/hanging render.
		expect(renderMs).toBeLessThan(10000);

		await expect(page.getByTestId('folder-item')).toContainText('Folder A');
	});

	test('shows the storage banner and blocks NEW session creation past 95%', async ({ page }) => {
		const seededCount = await seedOverBlockThreshold(page);
		await page.getByRole('tab', { name: 'Sessions' }).click();

		// >90% → persistent banner.
		await expect(page.getByTestId('storage-banner')).toBeVisible();
		await expect(page.getByTestId('session-item')).toHaveCount(seededCount);

		const consoleErrors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() !== 'error') return;
			const text = msg.text();
			// Ignore CSP resource-loading warnings (e.g. a data: font blocked by
			// `font-src 'self'`) — pre-existing app/CSP noise the strict privacy
			// CSP emits, unrelated to the storage cap this test verifies. A real
			// app error (uncaught exception, failed store write) is still caught.
			if (/Content Security Policy|Refused to (load|apply|evaluate|execute)/i.test(text)) return;
			consoleErrors.push(text);
		});

		await page.route('**/api/chat', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					model: 'gemma:7b',
					created_at: new Date().toISOString(),
					message: { role: 'assistant', content: 'ok' },
					done: true
				})
			});
		});

		// Creating a NEW session (its first saveSession, triggered by sending a
		// message) must be blocked now that usage is deterministically past 95%.
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option').first().click();
		await page.locator('.prompt-editor__textarea').fill('One more for good measure');
		await page.getByText('Run').click();

		// The block is the load-bearing behavior: the byte-usage toast fires
		// AND the new session is not persisted (count stays at the seeded total,
		// never grows). This asserts blocking actually happened — not the prior
		// tautology that also passed when blocking silently failed.
		await expect(page.getByText(/Storage full/)).toBeVisible();
		await expect(page.getByTestId('session-item')).toHaveCount(seededCount);

		expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
	});

	test('never blocks saving to an EXISTING session, even past the 95% cap', async ({ page }) => {
		const seededCount = await seedOverBlockThreshold(page);
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await expect(page.getByTestId('storage-banner')).toBeVisible();

		// Open an existing (seeded) session and append an exchange. The update
		// path must persist even over the cap — a user mid-conversation at the
		// ceiling must never get trapped; only NEW-session creation is blocked.
		// (The Ollama connection/model mocks from beforeEach survive the reload
		// in seedOverBlockThreshold, since they live in localStorage + page routes.)
		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('session-item').first().click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.locator('.prompt-editor__textarea').fill('Appending to an existing session over the cap');
		await page.getByText('Run').click();

		// It saved (assistant reply rendered), with no block toast.
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();
		await expect(page.getByText(/Storage full/)).not.toBeVisible();

		// And it actually persisted: the exchange survives a reload. Existing
		// session count is unchanged (we updated one, didn't create one).
		await page.reload();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();
		await expect(page.getByTestId('session-item')).toHaveCount(seededCount);
	});

	test('search filters 500 sessions quickly', async ({ page }) => {
		const sessions = Array.from({ length: 500 }, (_, i) => makeSession(i));
		await seedSessions(page, sessions);
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await expect(page.getByTestId('session-item')).toHaveCount(500);

		const searchStart = Date.now();
		await page.getByTestId('sidebar-search-input').fill('number 250 ');
		await expect(page.getByTestId('session-item')).toHaveCount(1);
		const searchMs = Date.now() - searchStart;
		console.log(`[stress] search-filter over 500 sessions (incl. Playwright round-trip): ${searchMs}ms`);
		// Same caveat as the render budget above: this includes Playwright's
		// own event dispatch/assertion polling overhead, not a pure in-page
		// measurement. Catches hangs, not micro-regressions against the <5ms
		// in-page budget.
		expect(searchMs).toBeLessThan(2000);
	});

	test('batch-deletes 100 sessions spread across folders and unfiled', async ({ page }) => {
		const folderSessions = Array.from({ length: 50 }, (_, i) => makeSession(i, { folderId: 'folder-a' }));
		const unfiledSessions = Array.from({ length: 450 }, (_, i) => makeSession(i + 50));
		const folders = [
			{ id: 'folder-a', name: 'Folder A', isExpanded: true, sortOrder: 0, updatedAt: new Date().toISOString() }
		];

		await page.evaluate(
			(data) => window.localStorage.setItem('hollama-folders', JSON.stringify(data)),
			folders
		);
		await seedSessions(page, [...folderSessions, ...unfiledSessions]);
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await expect(page.getByTestId('session-item')).toHaveCount(500);

		// Select all 50 in the folder via shift-click range (NOT the global
		// "select all", which selects all 500 visible sessions, not just this
		// subset), plus 50 unfiled via a second shift-click range.
		const folderCheckboxes = page.getByTestId('folder-item').getByTestId('session-select-checkbox');
		await folderCheckboxes.first().hover();
		await folderCheckboxes.first().click();
		await folderCheckboxes.last().hover();
		await folderCheckboxes.last().click({ modifiers: ['Shift'] });

		const unfiledCheckboxes = page.getByTestId('unfiled-drop-zone').getByTestId('session-select-checkbox');
		await unfiledCheckboxes.nth(0).hover();
		await unfiledCheckboxes.nth(0).click();
		await unfiledCheckboxes.nth(49).hover();
		await unfiledCheckboxes.nth(49).click({ modifiers: ['Shift'] });

		const selectedCount = await page.getByTestId('multi-select-count').textContent();
		expect(selectedCount).toContain('100 selected');

		page.on('dialog', (dialog) => dialog.accept());
		const deleteStart = Date.now();
		await page.getByTestId('multi-select-delete').click();
		await expect(page.getByTestId('session-item')).toHaveCount(400);
		const deleteMs = Date.now() - deleteStart;
		console.log(`[stress] batch-delete of 100/500 sessions: ${deleteMs}ms`);
		expect(deleteMs).toBeLessThan(3000);
	});
});
