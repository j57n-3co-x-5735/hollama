import { expect, test, type Route } from '@playwright/test';

import {
	chooseFromCombobox,
	MOCK_OPENAI_COMPLETION_RESPONSE_1,
	MOCK_OPENAI_MODELS,
	MOCK_SESSION_1_RESPONSE_1,
	mockOllamaModelsResponse,
	mockOpenAICompletionResponse,
	mockOpenAICompletionResponseWithCapture,
	mockOpenAIModelsResponse
} from './utils';

test.describe('OpenAI Integration', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/settings');
	});

	// Re-navigate to /settings with a mocked /api/metadata so Servers.svelte's
	// onMount probe reports the desired isDesktop (keyless is desktop-only).
	async function withMetadata(page: import('@playwright/test').Page, isDesktop: boolean) {
		await page.route('**/api/metadata', (route) =>
			route.fulfill({
				json: { isDesktop, hasServerApiKey: false, isDocker: false, currentVersion: '0.0.0' }
			})
		);
		await page.goto('/settings');
	}

	test('OpenAI-Compatible keyless verify succeeds and never POSTs a key (desktop)', async ({
		page
	}) => {
		await withMetadata(page, true);
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Compatible servers (i.e. llama.cpp)');
		await page.getByText('Add connection').click();

		let keysPost = false;
		await page.route('**/api/keys', (route) => {
			if (route.request().method() === 'POST') keysPost = true;
			route.fulfill({ json: { ok: true } });
		});
		await page.route('**/api/models**', (route) => route.fulfill({ json: { data: MOCK_OPENAI_MODELS } }));

		// Leave the API Key blank → keyless.
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('Connection has been verified and is ready to use')).toBeVisible();
		expect(keysPost).toBe(false); // no credential stored for a keyless server
	});

	test('OpenAI-Compatible keyed verify still POSTs the key', async ({ page }) => {
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Compatible servers (i.e. llama.cpp)');
		await page.getByText('Add connection').click();

		let keysPost = false;
		let postedApiKey: unknown = undefined;
		await page.route('**/api/keys', (route) => {
			if (route.request().method() === 'POST') {
				keysPost = true;
				postedApiKey = (route.request().postDataJSON() as { apiKey?: unknown }).apiKey;
			}
			route.fulfill({ json: { ok: true } });
		});
		await page.route('**/api/models**', (route) => route.fulfill({ json: { data: MOCK_OPENAI_MODELS } }));

		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('Connection has been verified and is ready to use')).toBeVisible();
		expect(keysPost).toBe(true);
		expect(postedApiKey).toBe('sk-validapikey');
	});

	test('OpenAI official blank key blocks verify inline', async ({ page }) => {
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Official API');
		await page.getByText('Add connection').click();

		let keysCalled = false;
		let modelsCalled = false;
		await page.route('**/api/keys', (route) => {
			keysCalled = true;
			route.fulfill({ json: { ok: true } });
		});
		await page.route('**/api/models**', (route) => {
			modelsCalled = true;
			route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});

		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('API key is required')).toBeVisible();
		expect(keysCalled).toBe(false);
		expect(modelsCalled).toBe(false);
	});

	test('OpenAI-Compatible blank key blocks inline in web mode (mode-gated)', async ({ page }) => {
		await withMetadata(page, false);
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Compatible servers (i.e. llama.cpp)');
		await page.getByText('Add connection').click();

		let modelsCalled = false;
		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			modelsCalled = true;
			route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});

		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('API key is required')).toBeVisible();
		expect(modelsCalled).toBe(false); // never reaches the proxy in web mode
	});

	test('OpenAI-Compatible whitespace-only key is treated as keyless (desktop)', async ({ page }) => {
		await withMetadata(page, true);
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Compatible servers (i.e. llama.cpp)');
		await page.getByText('Add connection').click();

		let keysPost = false;
		await page.route('**/api/keys', (route) => {
			if (route.request().method() === 'POST') keysPost = true;
			route.fulfill({ json: { ok: true } });
		});
		await page.route('**/api/models**', (route) => route.fulfill({ json: { data: MOCK_OPENAI_MODELS } }));

		await page.getByLabel('API Key').fill('   ');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('Connection has been verified and is ready to use')).toBeVisible();
		expect(keysPost).toBe(false);
	});

	test('OpenAI-Compatible keyless verify surfaces the server-requires-key message', async ({
		page
	}) => {
		await withMetadata(page, true);
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Compatible servers (i.e. llama.cpp)');
		await page.getByText('Add connection').click();

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) =>
			route.fulfill({ status: 401, json: { error: 'This server requires an API key', status: 401 } })
		);

		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(page.getByText('This server requires an API key')).toBeVisible();
	});

	test('fails to fetch data with an incorrect API key', async ({ page }) => {
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Official API');
		await page.getByText('Add connection').click();
		await expect(page.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1');

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ status: 401, json: { error: 'Invalid API key', status: 401 } });
		});
		await page.getByLabel('API Key').fill('sk-invalidapikey');
		await page.getByRole('button', { name: 'Verify' }).click();

		await expect(page.getByText('Invalid API key')).toBeVisible();
	});

	test('handles network connection error', async ({ page }) => {
		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => route.abort('failed'));
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Official API');
		await page.getByText('Add connection').click();
		await expect(page.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1');

		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify' }).click();
		await expect(page.getByText('Cannot reach server')).toBeVisible();
	});

	test('cannot send fetch requests without a baseUrl set', async ({ page }) => {
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Official API');
		await page.getByText('Add connection').click();
		const verifyButton = page.getByRole('button', { name: 'Verify' });
		await expect(verifyButton).toBeEnabled();
		await expect(page.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1');

		await page.getByLabel('Base URL').clear();
		await expect(verifyButton).toBeDisabled();
	});

	test('models list is sorted correctly', async ({ page }) => {
		await mockOllamaModelsResponse(page);
		await mockOpenAIModelsResponse(page, MOCK_OPENAI_MODELS);

		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();

		const modelOptions = page.locator('div[role="option"]');
		await expect(modelOptions.nth(1)).toHaveText('gpt-3.5-turbo');
		await expect(modelOptions.nth(2)).toHaveText('gpt-4');
	});

	test('OpenAI model is added to recently used list after use', async ({ page }) => {
		await mockOpenAIModelsResponse(page, MOCK_OPENAI_MODELS);

		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		// Check that the model was not in the recently used list
		await expect(page.getByText('Recently used models', { exact: true })).not.toBeVisible();

		// Simulate sending a message (you might need to adjust this based on your actual UI)
		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await mockOpenAICompletionResponse(page, MOCK_OPENAI_COMPLETION_RESPONSE_1);
		await page.getByRole('button', { name: 'Run' }).click();
		await page.getByLabel('Available models').click();
		await expect(page.getByText('Recently used models', { exact: true })).toBeVisible();
		await expect(page.getByRole('option', { name: 'gpt-3.5-turbo' })).toBeVisible();
	});

	// TODO fix. Add mocked completion response
	test('OpenAI model is saved to localStorage for specific session', async ({ page }) => {
		await mockOpenAIModelsResponse(page, MOCK_OPENAI_MODELS);

		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();
		await mockOpenAICompletionResponse(page, MOCK_OPENAI_COMPLETION_RESPONSE_1);

		// Simulate sending a message
		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		// Check localStorage
		const sessions = await page.evaluate(() => localStorage.getItem('hollama-sessions'));
		expect(sessions).toContain('"name":"gpt-3.5-turbo"');
	});

	test('only GPT models are available in FieldModelSelect', async ({ page }) => {
		await mockOpenAIModelsResponse(page, MOCK_OPENAI_MODELS);
		expect(MOCK_OPENAI_MODELS).toHaveLength(3);
		expect(MOCK_OPENAI_MODELS[2].id).toContain('text-davinci-003');
		await expect(page.getByLabel('Model names filter')).toHaveValue('gpt');

		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await expect(page.getByRole('option', { name: 'gpt-3.5-turbo' })).toBeVisible();
		await expect(page.getByRole('option', { name: 'gpt-4' })).toBeVisible();
		await expect(page.getByRole('option', { name: 'text-davinci-003' })).not.toBeVisible();
	});

	test('sends prompt_cache_key when sessionAffinityKey is configured on OpenAICompatible', async ({
		page
	}) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();

		await page.getByLabel('Session affinity key').fill('test-affinity-key');

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', async (route: Route) => {
			await route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});
		// Credentials are server-side now: verifying an OpenAI-family connection
		// POSTs the key to /api/keys first, so a key must be present or
		// submitCredentials() aborts before the model probe runs.
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();

		const getBody = await mockOpenAICompletionResponseWithCapture(
			page,
			MOCK_OPENAI_COMPLETION_RESPONSE_1
		);

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const body = getBody();
		expect(body).not.toBeNull();
		expect((body as Record<string, unknown>).sessionAffinityKey).toBe('test-affinity-key');
	});

	test('does not send prompt_cache_key when sessionAffinityKey is not configured', async ({
		page
	}) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', async (route: Route) => {
			await route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});
		// Credentials are server-side now: verifying an OpenAI-family connection
		// POSTs the key to /api/keys first, so a key must be present or
		// submitCredentials() aborts before the model probe runs.
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();

		const getBody = await mockOpenAICompletionResponseWithCapture(
			page,
			MOCK_OPENAI_COMPLETION_RESPONSE_1
		);

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const body = getBody();
		expect(body).not.toBeNull();
		expect(body).not.toHaveProperty('sessionAffinityKey');
	});

	test('does not send sessionAffinityKey for OpenAI Official even if configured', async ({
		page
	}) => {
		await chooseFromCombobox(page, 'Connection type', 'OpenAI: Official API');
		await page.getByText('Add connection').click();

		// sessionAffinityKey field should not be visible for OpenAI Official
		await expect(page.getByLabel('Session affinity key')).not.toBeVisible();

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', async (route: Route) => {
			await route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();

		const getBody = await mockOpenAICompletionResponseWithCapture(
			page,
			MOCK_OPENAI_COMPLETION_RESPONSE_1
		);

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const body = getBody();
		expect(body).not.toBeNull();
		expect(body).not.toHaveProperty('sessionAffinityKey');
	});

	test('whitespace sessionAffinityKey treated as empty', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();

		await page.getByLabel('Session affinity key').fill('   ');

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', async (route: Route) => {
			await route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});
		// Credentials are server-side now: verifying an OpenAI-family connection
		// POSTs the key to /api/keys first, so a key must be present or
		// submitCredentials() aborts before the model probe runs.
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();

		const getBody = await mockOpenAICompletionResponseWithCapture(
			page,
			MOCK_OPENAI_COMPLETION_RESPONSE_1
		);

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const body = getBody();
		expect(body).not.toBeNull();
		expect(body).not.toHaveProperty('sessionAffinityKey');
	});
});

test.describe('Fireworks Fallback', () => {
	const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';

	test.beforeEach(async ({ page }) => {
		await page.goto('/settings');
	});

	test('Fireworks auth error shows Invalid API key', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();
		await page.getByLabel('Base URL').clear();
		await page.getByLabel('Base URL').fill(FIREWORKS_BASE_URL);

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ status: 401, json: { error: 'Invalid API key', status: 401 } });
		});
		await page.getByLabel('API Key').fill('sk-bad-key');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();

		await expect(page.getByText('Invalid API key')).toBeVisible();
	});

	test('non-Fireworks 500 does not trigger fallback', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();
		await page.getByLabel('Base URL').clear();
		await page.getByLabel('Base URL').fill('https://api.example.com/v1');

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ status: 500, json: { error: 'Internal server error', status: 500 } });
		});
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();

		await expect(page.getByText('Internal server error')).toBeVisible();
	});

	test('Fireworks probeChat succeeds when models fail', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();
		await page.getByLabel('Base URL').clear();
		await page.getByLabel('Base URL').fill(FIREWORKS_BASE_URL);

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ status: 500, json: { error: 'Server error', status: 500 } });
		});
		await page.route('**/api/chat', (route) => {
			route.fulfill({ status: 404, json: { error: 'Model not found' } });
		});
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();

		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();
	});

	test('Fireworks probeChat auth failure shows Invalid API key', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();
		await page.getByLabel('Base URL').clear();
		await page.getByLabel('Base URL').fill(FIREWORKS_BASE_URL);

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({ status: 500, json: { error: 'Server error', status: 500 } });
		});
		await page.route('**/api/chat', (route) => {
			route.fulfill({ status: 401, json: { error: 'Invalid API key' } });
		});
		await page.getByLabel('API Key').fill('sk-bad-key');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();

		await expect(page.getByText('Invalid API key')).toBeVisible();
	});

	test('Fireworks 403 shows Access denied', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();
		await page.getByLabel('Base URL').clear();
		await page.getByLabel('Base URL').fill(FIREWORKS_BASE_URL);

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => {
			route.fulfill({
				status: 403,
				json: { error: 'Access denied — check API key permissions', status: 403 }
			});
		});
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();

		await expect(page.getByText('Access denied')).toBeVisible();
	});

	test('network error shows Cannot reach server', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();
		await page.getByLabel('Base URL').clear();
		await page.getByLabel('Base URL').fill(FIREWORKS_BASE_URL);

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', (route) => route.abort('failed'));
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();

		await expect(page.getByText('Cannot reach server')).toBeVisible();
	});

	test('copy button visible with OpenAI-compatible endpoint', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', async (route: Route) => {
			await route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});
		// Credentials are server-side now: verifying an OpenAI-family connection
		// POSTs the key to /api/keys first, so a key must be present or
		// submitCredentials() aborts before the model probe runs.
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();

		await mockOpenAICompletionResponse(page, MOCK_OPENAI_COMPLETION_RESPONSE_1);

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		await page.locator('.prompt-editor__textarea').fill('Hello');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await expect(page.getByTestId('session-copy-button')).toBeVisible();
	});

	test('system prompt appears in OpenAI-compatible payload', async ({ page }) => {
		await chooseFromCombobox(
			page,
			'Connection type',
			'OpenAI: Compatible servers (i.e. llama.cpp)'
		);
		await page.getByText('Add connection').click();

		await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
		await page.route('**/api/models**', async (route: Route) => {
			await route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
		});
		// Credentials are server-side now: verifying an OpenAI-family connection
		// POSTs the key to /api/keys first, so a key must be present or
		// submitCredentials() aborts before the model probe runs.
		await page.getByLabel('API Key').fill('sk-validapikey');
		await page.getByRole('button', { name: 'Verify', exact: true }).click();
		await expect(
			page.getByText('Connection has been verified and is ready to use')
		).toBeVisible();

		const getBody = await mockOpenAICompletionResponseWithCapture(
			page,
			MOCK_OPENAI_COMPLETION_RESPONSE_1
		);

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await page.getByLabel('Available models').click();
		await page.getByRole('option', { name: 'gpt-3.5-turbo' }).click();

		// Set system prompt via header panel
		await page.getByTestId('session-system-prompt-button').click();
		await page.locator('#session-system-prompt-textarea').fill('You are a coding assistant');

		// Send a message
		await page.locator('.prompt-editor__textarea').fill('Hello, AI!');
		await page.getByRole('button', { name: 'Run' }).click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const body = getBody() as Record<string, unknown>;
		expect(body).not.toBeNull();
		const messages = body.messages as Array<{ role: string; content: string }>;
		expect(messages[0]).toEqual({ role: 'system', content: 'You are a coding assistant' });
		expect(messages[1]).toMatchObject({ role: 'user', content: 'Hello, AI!' });
	});
});
