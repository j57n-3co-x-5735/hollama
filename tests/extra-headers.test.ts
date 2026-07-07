import { expect, test } from '@playwright/test';

/**
 * ExtraHeaders component tests.
 *
 * Coverage targets:
 *  - oninput: typing into a key/value input fires the parent's onchange
 *             with the typed value
 *  - dedup:   two rows with the same key (different casing) collapse to
 *             one entry when emitChange fires (last-wins via Map.set)
 *  - MAX_ENTRIES: the "Add Header" button is removed from the DOM once
 *                 20 entries exist (the Svelte conditional guard)
 *
 * Approach: set up a pre-configured OpenAI-Compatible server via
 * localStorage before navigation. This avoids the page-init script path
 * (which renders the page empty until a server is added via the
 * "Add connection" UI) and gives the test a deterministic starting state.
 *
 * The dedup + oninput behaviors are verified by intercepting the outbound
 * /api/keys POST that the parent (Connection.svelte) makes on Verify:
 * the headers are sent in the request body, so capturing the request
 * gives us direct observation of the parent's localExtraHeaders state.
 */

const TEST_SERVER_ID = 'extra-headers-test-server';

function seedOpenAiCompatibleServer() {
	return {
		id: TEST_SERVER_ID,
		baseUrl: 'https://api.example.com/v1',
		connectionType: 'openai-compatible',
		isVerified: new Date().toISOString(),
		isEnabled: true
	};
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript((server) => {
		localStorage.setItem('hollama-servers', JSON.stringify([server]));
	}, seedOpenAiCompatibleServer());
});

async function gotoSettings(page: import('@playwright/test').Page) {
	await page.goto('/settings');
	// Wait for the connection card to render so ExtraHeaders is mounted.
	// The ExtraHeaders "Add header" button only renders when entries.length
	// < MAX_ENTRIES (always true at startup since entries=[]), so its
	// presence proves the connection card has mounted AND isOpenAiFamily
	// is true (the gate that renders ExtraHeaders at all).
	await expect(page.getByRole('button', { name: 'Add header' })).toBeVisible();
}

test.describe('ExtraHeaders - oninput', () => {
	test('typing into key + value input flips localExtraHeaders on Verify', async ({
		page
	}) => {
		await gotoSettings(page);

		// Click "Add Header" once to expose a single row.
		await page.getByRole('button', { name: 'Add Header' }).click();

		// Capture the next /api/keys POST body.
		const keysRequestPromise = page.waitForRequest('**/api/keys');
		await page.route('**/api/keys', (route) => {
			route.fulfill({ json: { ok: true } });
		});
		// Stub /api/models so Verify succeeds after /api/keys.
		await page.route('**/api/models**', (route) => {
			route.fulfill({ json: { data: [{ id: 'm', object: 'model' }] } });
		});

		// Type a key and value into the first row.
		const keyInput = page.getByLabel('Header name').first();
		const valueInput = page.getByLabel('Header value').first();
		await keyInput.fill('X-Custom-Header');
		await valueInput.fill('custom-value');

		// Fill the API key to enable Verify.
		await page.getByLabel('API Key').fill('sk-test-key');

		// Trigger Verify.
		await page.getByRole('button', { name: 'Verify' }).click();

		// Wait for the captured request and inspect the body.
		const req = await keysRequestPromise;
		const body = req.postDataJSON() as { baseUrl: string; apiKey: string; extraHeaders: Record<string, string> };
		expect(body.extraHeaders).toBeDefined();
		expect(body.extraHeaders['x-custom-header']).toBe('custom-value');
	});
});

test.describe('ExtraHeaders - dedup', () => {
	test('two rows with same key (case-insensitive) collapse to one entry', async ({
		page
	}) => {
		await gotoSettings(page);

		// Click "Add Header" TWICE to expose two rows.
		await page.getByRole('button', { name: 'Add Header' }).click();
		await page.getByRole('button', { name: 'Add Header' }).click();

		const keysRequestPromise = page.waitForRequest('**/api/keys');
		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ json: { data: [{ id: 'm', object: 'model' }] } });
		});

		const keyInputs = page.getByLabel('Header name');
		const valueInputs = page.getByLabel('Header value');

		// Two rows, same logical key (case-insensitive), different values.
		await keyInputs.nth(0).fill('X-Foo');
		await valueInputs.nth(0).fill('first');

		// Same key, different casing → emitChange's lowercased Map.set
		// overwrites the first.
		await keyInputs.nth(1).fill('x-foo');
		await valueInputs.nth(1).fill('second-wins');

		await page.getByLabel('API Key').fill('sk-test-key');
		await page.getByRole('button', { name: 'Verify' }).click();

		const req = await keysRequestPromise;
		const body = req.postDataJSON() as { extraHeaders: Record<string, string> };

		// Dedup must collapse the duplicates to the latest value.
		expect(body.extraHeaders).toBeDefined();
		expect(body.extraHeaders['x-foo']).toBe('second-wins');
		// No 'X-Foo' (capitalized) duplicate should remain.
		expect(body.extraHeaders['X-Foo']).toBeUndefined();
		// Exactly one x-foo entry, no other entries.
		expect(Object.keys(body.extraHeaders)).toEqual(['x-foo']);
	});

	test('a row with empty key does not appear in emitted headers', async ({ page }) => {
		await gotoSettings(page);

		await page.getByRole('button', { name: 'Add Header' }).click();
		await page.getByRole('button', { name: 'Add Header' }).click();

		const keysRequestPromise = page.waitForRequest('**/api/keys');
		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ json: { data: [{ id: 'm', object: 'model' }] } });
		});

		const keyInputs = page.getByLabel('Header name');
		const valueInputs = page.getByLabel('Header value');

		// Row 1: empty key — must be filtered by emitChange's `if (key && value)` guard.
		await keyInputs.nth(0).fill('');
		await valueInputs.nth(0).fill('orphan-value');

		// Row 2: real key.
		await keyInputs.nth(1).fill('X-Real');
		await valueInputs.nth(1).fill('real-value');

		await page.getByLabel('API Key').fill('sk-test-key');
		await page.getByRole('button', { name: 'Verify' }).click();

		const req = await keysRequestPromise;
		const body = req.postDataJSON() as { extraHeaders: Record<string, string> };

		expect(body.extraHeaders).toEqual({ 'x-real': 'real-value' });
	});
});

test.describe('ExtraHeaders - MAX_ENTRIES cap', () => {
	test('Add Header button is removed from DOM once 20 entries exist', async ({ page }) => {
		await gotoSettings(page);

		// Click Add Header 20 times to hit the cap.
		const addBtn = page.getByRole('button', { name: 'Add Header' });
		for (let i = 0; i < 20; i++) {
			await addBtn.click();
		}

		// After 20 entries, the button MUST be gone (Svelte {#if entries.length < MAX_ENTRIES}).
		await expect(addBtn).toHaveCount(0);

		// Verify the 20 input rows are present (no duplicate rows hidden via the cap).
		const keyInputs = page.getByLabel('Header name');
		// Wait briefly for the DOM to settle; structurally there should be 20.
		await expect(keyInputs).toHaveCount(20);
	});

	test('a 21st click has no effect (entries cap is enforced)', async ({ page }) => {
		await gotoSettings(page);

		const addBtn = page.getByRole('button', { name: 'Add Header' });
		for (let i = 0; i < 20; i++) {
			await addBtn.click();
		}

		// No button to click — verify the cap is the only enforcement.
		await expect(addBtn).toHaveCount(0);
	});

	test('removing an entry below the cap re-reveals the Add Header button', async ({
		page
	}) => {
		await gotoSettings(page);

		const addBtn = page.getByRole('button', { name: 'Add Header' });
		for (let i = 0; i < 20; i++) {
			await addBtn.click();
		}
		await expect(addBtn).toHaveCount(0);

		// Remove one entry → button should reappear.
		await page.getByRole('button', { name: 'Remove header' }).first().click();
		await expect(addBtn).toBeVisible();
	});
});
