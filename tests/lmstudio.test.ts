import { expect, test } from '@playwright/test';

import { chooseFromCombobox } from './utils';

// LM Studio's OpenAI-compatible `/v1/models` returns the OpenAI envelope shape
// (`{ data: [{ id, object, owned_by }] }`). Model ids can contain slashes.
const MOCK_LMSTUDIO_MODELS = [
	{ id: 'qwen3.6-27b-mtp', object: 'model', owned_by: 'organization_owner' },
	{ id: 'liquid/lfm2.5-1.2b', object: 'model', owned_by: 'organization_owner' }
];

test.describe('LM Studio Integration', () => {
	// Re-navigate to /settings with a mocked /api/metadata so Servers.svelte's
	// onMount probe reports isDesktop — keyless proxying (and therefore LM Studio,
	// which has no API key) is only allowed on desktop.
	async function withMetadata(page: import('@playwright/test').Page, isDesktop: boolean) {
		await page.route('**/api/metadata', (route) =>
			route.fulfill({
				json: { isDesktop, hasServerApiKey: false, isDocker: false, currentVersion: '0.0.0' }
			})
		);
		await page.goto('/settings');
	}

	test('keyless verify shows no API key field, defaults to /v1, and populates the model picker', async ({
		page
	}) => {
		await withMetadata(page, true);
		await chooseFromCombobox(page, 'Connection type', 'LM Studio');
		await page.getByText('Add connection').click();

		const connection = page.getByTestId('server').first();

		// LM Studio is keyless: none of the OpenAI-family credential UI appears.
		await expect(connection.getByLabel('API Key')).not.toBeVisible();
		await expect(connection.getByLabel('Session affinity key')).not.toBeVisible();
		// The default Base URL carries the required `/v1` suffix (a missing `/v1`
		// is exactly what produced the "green toast, empty picker" bug).
		await expect(connection.getByLabel('Base URL')).toHaveValue('http://localhost:1234/v1');

		let keysPost = false;
		await page.route('**/api/keys', (route) => {
			if (route.request().method() === 'POST') keysPost = true;
			route.fulfill({ json: { ok: true } });
		});
		await page.route('**/api/models**', (route) =>
			route.fulfill({ json: { data: MOCK_LMSTUDIO_MODELS } })
		);

		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('Connection has been verified and is ready to use')).toBeVisible();
		expect(keysPost).toBe(false); // keyless — no credential is ever stored

		// The core fix: models actually reach the picker (verify succeeding is no
		// longer decoupled from models being available).
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await expect(page.getByRole('option', { name: 'qwen3.6-27b-mtp' })).toBeVisible();
		await expect(page.getByRole('option', { name: 'liquid/lfm2.5-1.2b' })).toBeVisible();
	});

	test('honest verify: a 200 response with an error body (no data array) fails instead of a false green', async ({
		page
	}) => {
		await withMetadata(page, true);
		await chooseFromCombobox(page, 'Connection type', 'LM Studio');
		await page.getByText('Add connection').click();

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		// LM Studio answers an unknown path (e.g. a Base URL missing `/v1`) with
		// HTTP 200 and an error body. The old code treated the absent `data` array
		// as an empty model list and reported success — this must now fail loudly
		// with the upstream's message.
		await page.route('**/api/models**', (route) =>
			route.fulfill({
				status: 200,
				json: { error: 'Unexpected endpoint or method. (GET /models)' }
			})
		);

		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('Unexpected endpoint or method. (GET /models)')).toBeVisible();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).not.toBeVisible();
	});
});
