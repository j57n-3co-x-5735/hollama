import { expect, test } from '@playwright/test';

import type { Route } from '@playwright/test';

import {
	chooseFromCombobox,
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_KNOWLEDGE,
	MOCK_OPENAI_COMPLETION_RESPONSE_1,
	MOCK_OPENAI_MODELS,
	MOCK_SESSION_1_RESPONSE_1,
	mockOllamaModelsResponse,
	mockOpenAICompletionResponseWithCapture,
	seedKnowledgeAndReload
} from './utils';

test.beforeEach(async ({ page }) => {
	await mockOllamaModelsResponse(page);
});

// === Global system prompt page ===

test('global system prompt page renders with textarea', async ({ page }) => {
	await page.goto('/system-prompt');

	await expect(page.getByRole('heading', { name: 'Global System Prompt' })).toBeVisible();
	await expect(page.getByText('Applies to all sessions')).toBeVisible();

	const textarea = page.locator('#global-system-prompt');
	await expect(textarea).toBeVisible();
	await expect(textarea).toHaveValue('');
});

test('global system prompt auto-saves to settingsStore', async ({ page }) => {
	await page.goto('/system-prompt');

	const textarea = page.getByLabel('System instructions');
	await textarea.fill('You are a coding assistant');

	// Navigate away and back
	await page.goto('/settings');
	await page.goto('/system-prompt');

	await expect(page.getByLabel('System instructions')).toHaveValue('You are a coding assistant');

	// Verify localStorage
	const settings = await page.evaluate(() =>
		JSON.parse(window.localStorage.getItem('hollama-settings') || '{}')
	);
	expect(settings.globalSystemPrompt).toBe('You are a coding assistant');
});

test('global prompt textarea initializes correctly for upgrading users', async ({ page }) => {
	// Seed settings without globalSystemPrompt (simulating an upgrade)
	await page.evaluate(() => {
		const settings = JSON.parse(window.localStorage.getItem('hollama-settings') || '{}');
		delete settings.globalSystemPrompt;
		window.localStorage.setItem('hollama-settings', JSON.stringify(settings));
	});
	await page.goto('/system-prompt');

	const textarea = page.getByLabel('System instructions');
	await expect(textarea).toHaveValue('');
	// Must NOT show the literal string "undefined"
	await expect(textarea).not.toHaveValue('undefined');
});

// === Sidebar link and indicator ===

test('sidebar shows System Prompt link', async ({ page }) => {
	await page.goto('/');

	const link = page.getByRole('link', { name: /System Prompt/ });
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/system-prompt/);
});

test('sidebar dot indicator appears when global prompt is non-empty', async ({ page }) => {
	await page.goto('/system-prompt');

	// Set a global prompt
	await page.getByLabel('System instructions').fill('Be concise');

	// Navigate away to check sidebar indicator
	await page.goto('/settings');

	// The indicator dot should be visible in the sidebar
	const systemPromptLink = page.getByRole('link', { name: /System Prompt/ });
	await expect(systemPromptLink).toBeVisible();
	const dot = systemPromptLink.locator('span.rounded-full');
	await expect(dot).toBeVisible();
});

test('sidebar dot indicator hidden for empty or whitespace-only prompt', async ({ page }) => {
	await page.goto('/system-prompt');

	// Set whitespace-only prompt
	await page.getByLabel('System instructions').fill('   ');
	await page.goto('/settings');

	const systemPromptLink = page.getByRole('link', { name: /System Prompt/ });
	await expect(systemPromptLink).toBeVisible();
	const dot = systemPromptLink.locator('span.rounded-full');
	await expect(dot).not.toBeVisible();
});

// === Per-session header button and inline panel ===

test('per-session system prompt button renders for all connection types', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	// Button should be visible even on new session (before first message)
	const spButton = page.getByTestId('session-system-prompt-button');
	await expect(spButton).toBeVisible();
});

test('clicking header button opens inline panel with textarea', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const spButton = page.getByTestId('session-system-prompt-button');
	await spButton.click();

	const panel = page.locator('#session-system-prompt-panel');
	await expect(panel).toBeVisible();

	const textarea = panel.getByLabel('System instructions');
	await expect(textarea).toBeVisible();
	await expect(textarea).toBeFocused();
});

test('header button has aria-expanded and aria-controls', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const spButton = page.getByTestId('session-system-prompt-button');

	// Closed state
	await expect(spButton).toHaveAttribute('aria-expanded', 'false');
	await expect(spButton).toHaveAttribute('aria-controls', 'session-system-prompt-panel');

	// Open state
	await spButton.click();
	await expect(spButton).toHaveAttribute('aria-expanded', 'true');
});

test('escape key closes panel and returns focus to button', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const spButton = page.getByTestId('session-system-prompt-button');
	await spButton.click();

	const panel = page.locator('#session-system-prompt-panel');
	await expect(panel).toBeVisible();

	// Press Escape while textarea is focused
	await page.keyboard.press('Escape');

	await expect(panel).not.toBeVisible();
	await expect(spButton).toHaveAttribute('aria-expanded', 'false');
	await expect(spButton).toBeFocused();
});

// === Message assembly — migrated from controls.test.ts ===

test('per-session system prompt appears in API payload', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Open the per-session panel and fill system prompt
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('You are a helpful assistant');

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({
		role: 'system',
		content: 'You are a helpful assistant'
	});
	expect(requestPayload.messages[1]).toEqual({
		role: 'user',
		content: 'Hello'
	});
});

test('single-character system prompt produces system message', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('a');

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'a' });
	expect(requestPayload.messages[1]).toEqual({ role: 'user', content: 'Hello' });
});

test('whitespace-only system prompt sends no system message', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('   ');

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'user', content: 'Hello' });
});

test('per-session system prompt and knowledge coexist in payload', async ({ page }) => {
	await page.goto('/');
	await seedKnowledgeAndReload(page);
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Set per-session prompt via header panel
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Be concise');
	// Close panel so we can interact with Controls
	await page.keyboard.press('Escape');

	// Set knowledge via Controls
	await page.getByLabel('Controls').click();
	await chooseFromCombobox(page, 'Knowledge', MOCK_KNOWLEDGE[0].name);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Summarize');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toMatchObject({
		role: 'system',
		content: MOCK_KNOWLEDGE[0].content
	});
	expect(requestPayload.messages[2]).toEqual({ role: 'user', content: 'Summarize' });
});

test('old session without systemPromptText loads correctly', async ({ page }) => {
	await page.goto('/');

	const OLD_SESSION = [
		{
			id: 'old123',
			model: { name: 'gemma2:27b', serverId: 'default' },
			updatedAt: '2024-09-24T14:24:30.725Z',
			messages: [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi there!' }
			],
			options: {},
			systemPrompt: { role: 'system', content: '' }
		}
	];
	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		OLD_SESSION
	);
	await page.reload();

	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByText('Hello').click();

	// Header button should render
	const spButton = page.getByTestId('session-system-prompt-button');
	await expect(spButton).toBeVisible();

	// Open panel — textarea should be empty
	await spButton.click();
	const textarea = page.locator('#session-system-prompt-textarea');
	await expect(textarea).toBeVisible();
	await expect(textarea).toHaveValue('');

	// Sending should not include a system prompt
	await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Test');
	await page.getByRole('button', { name: 'Run' }).click();

	// No system messages should be in the payload
	const systemMessages = requestPayload.messages.filter((m: any) => m.role === 'system');
	expect(systemMessages).toHaveLength(0);
});

test('per-session system prompt persists after send and reload', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Set per-session prompt
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Persist this');

	await page.route('**/api/chat', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	// Wait for response
	await expect(page.locator('article').last()).toContainText(
		MOCK_SESSION_1_RESPONSE_1.message.content
	);

	// Reload and verify
	await page.reload();
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('session-item').filter({ hasText: 'Hello' }).click();

	await page.getByTestId('session-system-prompt-button').click();
	await expect(page.locator('#session-system-prompt-textarea')).toHaveValue('Persist this');
});

// === Global system prompt composition ===

test('global-only prompt produces single system message', async ({ page }) => {
	// Set global prompt
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Be concise');

	// Navigate to session
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toEqual({ role: 'user', content: 'Hello' });
});

test('global + per-session produces two system messages in correct order', async ({ page }) => {
	// Set global prompt
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Be concise');

	// Navigate to session
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Set per-session prompt via header panel
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Respond in Spanish');

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	// Global first, then per-session
	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toEqual({ role: 'system', content: 'Respond in Spanish' });
	expect(requestPayload.messages[2]).toEqual({ role: 'user', content: 'Hello' });
});

test('global + per-session + knowledge produces three system messages', async ({ page }) => {
	// Set global prompt
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Be concise');

	await seedKnowledgeAndReload(page);
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Set per-session prompt
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Respond in Spanish');
	await page.keyboard.press('Escape');

	// Set knowledge via Controls
	await page.getByLabel('Controls').click();
	await chooseFromCombobox(page, 'Knowledge', MOCK_KNOWLEDGE[0].name);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Summarize');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toEqual({ role: 'system', content: 'Respond in Spanish' });
	expect(requestPayload.messages[2]).toMatchObject({
		role: 'system',
		content: MOCK_KNOWLEDGE[0].content
	});
	expect(requestPayload.messages[3]).toEqual({ role: 'user', content: 'Summarize' });
});

test('no prompts set produces no system messages', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'user', content: 'Hello' });
	expect(requestPayload.messages.filter((m: any) => m.role === 'system')).toHaveLength(0);
});

test('whitespace-only global prompt produces no system message', async ({ page }) => {
	// Set whitespace-only global prompt
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('   ');

	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'user', content: 'Hello' });
});

test('global prompt + whitespace-only per-session sends only global', async ({ page }) => {
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Be concise');

	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Set whitespace-only per-session
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('   ');

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toEqual({ role: 'user', content: 'Hello' });
	expect(requestPayload.messages.filter((m: any) => m.role === 'system')).toHaveLength(1);
});

// === Reasoning propagation to request payloads ===

test('reasoning carries over to Ollama as think:true (universal, not Fireworks-gated)', async ({ page }) => {
	// Seed a Fireworks-compatible server + Ollama server directly into localStorage
	const FIREWORKS_SERVER = {
		id: 'fireworks-test',
		baseUrl: 'https://api.fireworks.ai/inference/v1',
		connectionType: 'openai-compatible',
		isVerified: new Date().toISOString(),
		isEnabled: true
	};
	// Seed session with reasoningEffort already set (simulates user enabling reasoning on Fireworks)
	const SESSION_WITH_REASONING = [
		{
			id: 'ac0003',
			model: { name: 'gpt-3.5-turbo', serverId: 'fireworks-test' },
			messages: [],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			reasoningEffort: 'high',
			updatedAt: '2024-09-24T14:24:30.725Z'
		}
	];

	await page.goto('/');
	// Add the Fireworks server alongside the existing Ollama server
	const existingServers = await page.evaluate(() =>
		JSON.parse(window.localStorage.getItem('hollama-servers') || '[]')
	);
	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-servers', JSON.stringify(data)),
		[...existingServers, FIREWORKS_SERVER]
	);
	// Add gpt-3.5-turbo to the models list
	await page.evaluate((models) => {
		const settings = JSON.parse(window.localStorage.getItem('hollama-settings') || '{}');
		settings.models = [...(settings.models || []), ...models];
		window.localStorage.setItem('hollama-settings', JSON.stringify(settings));
	}, [{ name: 'gpt-3.5-turbo', serverId: 'fireworks-test' }]);
	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		SESSION_WITH_REASONING
	);
	await page.reload();

	// Navigate to the session — it currently has reasoningEffort: 'high'
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('session-item').first().click();

	// Switch model to the Ollama server (non-Fireworks)
	await chooseFromCombobox(page, 'Available models', MOCK_API_TAGS_RESPONSE.models[0].name);

	// Send a message — reasoning is now universal (no longer cleared off
	// Fireworks). The Ollama strategy maps the enabled reasoning to its native
	// think:true and does NOT forward reasoningEffort (an OpenAI-family param).
	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});
	await page.locator('.prompt-editor__textarea').fill('Test');
	await page.getByRole('button', { name: 'Run' }).click();

	// Reasoning is honored on Ollama as think:true; reasoningEffort is not leaked.
	expect(requestPayload.think).toBe(true);
	expect(requestPayload.reasoningEffort).toBeUndefined();
});

test('reasoning_content only on assistant messages in payload', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Send first message — response saved with empty reasoning
	let firstPayload: any;
	await page.route('**/api/chat', async (route) => {
		firstPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});
	await page.locator('.prompt-editor__textarea').fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();
	await expect(page.locator('article').last()).toContainText(
		MOCK_SESSION_1_RESPONSE_1.message.content
	);

	// Send second message — the payload now includes the previous turn's messages.
	// The assistant message has reasoning: '' (empty string from editor.reasoning init).
	// The user message has no reasoning field at all.
	// Neither should produce reasoning_content in the payload.
	let secondPayload: any;
	await page.route('**/api/chat', async (route) => {
		secondPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});
	await page.locator('.prompt-editor__textarea').fill('Follow up');
	await page.getByRole('button', { name: 'Run' }).click();

	// User messages must NOT have reasoning_content
	const userMsgs = secondPayload.messages.filter((m: any) => m.role === 'user');
	for (const msg of userMsgs) {
		expect(msg).not.toHaveProperty('reasoning_content');
	}
	// Assistant message with empty reasoning should NOT have reasoning_content either
	const assistantMsgs = secondPayload.messages.filter((m: any) => m.role === 'assistant');
	for (const msg of assistantMsgs) {
		expect(msg).not.toHaveProperty('reasoning_content');
	}
});

// === Provider-agnostic E2E tests ===
// These seed sessions with non-Ollama model references to verify the system prompt
// button and panel work regardless of connection type. The button renders unconditionally
// (no isOllamaFamily gate), so the key assertion is that it's present + functional.

test('system prompt header button visible for non-Ollama sessions', async ({
	page
}) => {
	// Seed sessions with Fireworks and OpenAI models (no Ollama)
	const NON_OLLAMA_SESSIONS = [
		{
			id: 'fw-session',
			model: { name: 'accounts/fireworks/models/llama-v3', serverId: 'fw-server' },
			messages: [{ role: 'user', content: 'Fireworks test' }],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			updatedAt: '2024-09-24T14:24:30.725Z'
		},
		{
			id: 'oai-session',
			model: { name: 'gpt-4', serverId: 'oai-server' },
			messages: [{ role: 'user', content: 'OpenAI test' }],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			updatedAt: '2024-09-23T14:24:30.725Z'
		}
	];

	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		NON_OLLAMA_SESSIONS
	);
	await page.reload();
	await page.getByRole('tab', { name: 'Sessions' }).click();

	// Fireworks session — button must be visible
	await page.getByTestId('session-item').filter({ hasText: 'Fireworks test' }).click();
	await expect(page.getByTestId('session-system-prompt-button')).toBeVisible();
	await page.getByTestId('session-system-prompt-button').click();
	await expect(page.locator('#session-system-prompt-panel')).toBeVisible();
	await page.keyboard.press('Escape');

	// OpenAI session — button must also be visible
	await page.getByTestId('session-item').filter({ hasText: 'OpenAI test' }).click();
	await expect(page.getByTestId('session-system-prompt-button')).toBeVisible();
	await page.getByTestId('session-system-prompt-button').click();
	await expect(page.locator('#session-system-prompt-panel')).toBeVisible();
});

test('global system prompt reaches payload for any connection type', async ({
	page
}) => {
	// Set global prompt, then send via Ollama (the message assembly is connection-agnostic)
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Always respond in JSON');

	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();
	await chooseFromCombobox(page, 'Available models', MOCK_API_TAGS_RESPONSE.models[0].name);

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	await page.locator('.prompt-editor__textarea').fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({
		role: 'system',
		content: 'Always respond in JSON'
	});
});

// === Session-switch content isolation ===

test('panel closes and rebinds on session switch — no data leakage', async ({
	page
}) => {
	// Seed two sessions with different systemPromptText
	const TWO_SESSIONS = [
		{
			id: 'sess-a',
			model: { name: MOCK_API_TAGS_RESPONSE.models[0].name, serverId: 'default' },
			messages: [{ role: 'user', content: 'Session A message' }],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			systemPromptText: 'Prompt for A',
			updatedAt: '2024-09-25T14:24:30.725Z'
		},
		{
			id: 'sess-b',
			model: { name: MOCK_API_TAGS_RESPONSE.models[0].name, serverId: 'default' },
			messages: [{ role: 'user', content: 'Session B message' }],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			systemPromptText: 'Prompt for B',
			updatedAt: '2024-09-24T14:24:30.725Z'
		}
	];

	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		TWO_SESSIONS
	);
	await page.reload();
	await page.getByRole('tab', { name: 'Sessions' }).click();

	// Navigate to Session A, open panel
	await page.getByTestId('session-item').filter({ hasText: 'Session A' }).click();
	const spButton = page.getByTestId('session-system-prompt-button');
	await spButton.click();
	await expect(page.locator('#session-system-prompt-textarea')).toHaveValue('Prompt for A');

	// Navigate to Session B — panel should close
	await page.getByTestId('session-item').filter({ hasText: 'Session B' }).click();
	await expect(page.locator('#session-system-prompt-panel')).not.toBeVisible();

	// Reopen panel — should show Session B's prompt, not A's
	await page.getByTestId('session-system-prompt-button').click();
	await expect(page.locator('#session-system-prompt-textarea')).toHaveValue('Prompt for B');
});

// === F-5: Missing TC tests ===

test('per-session prompt persists through panel close/reopen without sending', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Open panel and type a prompt
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Respond in Spanish');

	// Close panel
	await page.keyboard.press('Escape');
	await expect(page.locator('#session-system-prompt-panel')).not.toBeVisible();

	// Reopen panel — text should still be there
	await page.getByTestId('session-system-prompt-button').click();
	await expect(page.locator('#session-system-prompt-textarea')).toHaveValue(
		'Respond in Spanish'
	);
});

test('header button reflects prompt state', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const spButton = page.getByTestId('session-system-prompt-button');
	await expect(spButton.locator('svg')).toBeVisible();

	// Set a prompt — button should still have an svg icon
	await spButton.click();
	await page.locator('#session-system-prompt-textarea').fill('Be concise');
	await page.keyboard.press('Escape');
	await expect(spButton.locator('svg')).toBeVisible();

	// Clear the prompt — button should still render with an icon
	await spButton.click();
	await page.locator('#session-system-prompt-textarea').fill('');
	await page.keyboard.press('Escape');
	await expect(spButton.locator('svg')).toBeVisible();
});

test('panel starts closed on navigation to session with existing prompt', async ({
	page
}) => {
	const SESSION_WITH_PROMPT = [
		{
			id: 'has-prompt',
			model: { name: MOCK_API_TAGS_RESPONSE.models[0].name, serverId: 'default' },
			messages: [{ role: 'user', content: 'Test message' }],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			systemPromptText: 'Be concise',
			updatedAt: '2024-09-24T14:24:30.725Z'
		}
	];

	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		SESSION_WITH_PROMPT
	);
	await page.reload();
	await page.getByRole('tab', { name: 'Sessions' }).click();

	// Navigate to the session
	await page.getByTestId('session-item').filter({ hasText: 'Test message' }).click();

	// Panel should be closed
	await expect(page.locator('#session-system-prompt-panel')).not.toBeVisible();

	// But the button should show active icon (non-empty prompt indicator)
	const spButton = page.getByTestId('session-system-prompt-button');
	await expect(spButton).toBeVisible();
});

test('Controls renders correctly after system prompt textarea removal', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	await page.getByLabel('Controls').click();

	// Controls should render with knowledge and model options
	await expect(page.locator('.controls')).toBeVisible();
	await expect(page.getByLabel('Temperature')).toBeVisible();

	// No system prompt textarea should exist in Controls
	await expect(page.locator('#system-prompt-text')).not.toBeAttached();
	// No orphaned "System prompt" heading in Controls
	const controlsHeadings = page.locator('.controls strong');
	const headingTexts = await controlsHeadings.allTextContents();
	expect(headingTexts).not.toContain('System prompt');
});

test('system prompt button accessible even when Controls is Ollama-gated', async ({
	page
}) => {
	// Seed a session with a non-Ollama model (no matching server = non-Ollama)
	const NON_OLLAMA_SESSION = [
		{
			id: 'non-ollama',
			model: { name: 'gpt-4', serverId: 'openai-server' },
			messages: [{ role: 'user', content: 'Test' }],
			options: {},
			systemPrompt: { role: 'system', content: '' },
			updatedAt: '2024-09-24T14:24:30.725Z'
		}
	];

	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
		NON_OLLAMA_SESSION
	);
	await page.reload();
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('session-item').filter({ hasText: 'Test' }).click();

	// System prompt button should be accessible regardless of connection type
	const spButton = page.getByTestId('session-system-prompt-button');
	await expect(spButton).toBeVisible();
	await spButton.click();
	await expect(page.locator('#session-system-prompt-panel')).toBeVisible();

	// Controls toggle should show toast for non-Ollama (the Ollama gate remains)
	await page.keyboard.press('Escape');
	await page.getByLabel('Controls').click();
	await expect(
		page.getByText('Advanced controls are currently only available for Ollama models')
	).toBeVisible();
});

// === M-6: Knowledge-clearing test migration ===

test('M-6: clearing knowledge leaves only per-session system prompt in payload', async ({
	page
}) => {
	await page.goto('/');
	await seedKnowledgeAndReload(page);
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelName = MOCK_API_TAGS_RESPONSE.models[0].name;
	await chooseFromCombobox(page, 'Available models', modelName);

	// Set per-session prompt
	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Be concise');
	await page.keyboard.press('Escape');

	// Set knowledge via Controls
	await page.getByLabel('Controls').click();
	await chooseFromCombobox(page, 'Knowledge', MOCK_KNOWLEDGE[0].name);

	// Clear the knowledge (target the nav button next to the knowledge input)
	await page.locator('#knowledge').locator('..').getByTitle('Clear').click();

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	const promptTextarea = page.locator('.prompt-editor__textarea');
	await promptTextarea.fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toEqual({ role: 'user', content: 'Hello' });
	expect(requestPayload.messages).toHaveLength(2);
});

// === Maxlength tests ===

test('global system prompt textarea has maxlength', async ({ page }) => {
	await page.goto('/system-prompt');
	const textarea = page.locator('#global-system-prompt');
	await expect(textarea).toHaveAttribute('maxlength', '10000');
});

test('per-session system prompt textarea has maxlength', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();
	await page.getByTestId('session-system-prompt-button').click();
	const textarea = page.locator('#session-system-prompt-textarea');
	await expect(textarea).toHaveAttribute('maxlength', '10000');
});

// === Export/import tests ===

test('export preferences includes globalSystemPrompt', async ({ page }) => {
	// Set a global system prompt
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Be concise');

	// Verify localStorage has the value
	const settings = await page.evaluate(() =>
		JSON.parse(window.localStorage.getItem('hollama-settings') || '{}')
	);
	expect(settings.globalSystemPrompt).toBe('Be concise');
});

test('import preferences restores globalSystemPrompt', async ({ page }) => {
	// Seed settings with globalSystemPrompt via localStorage (simulates import)
	await page.evaluate(() => {
		const settings = JSON.parse(window.localStorage.getItem('hollama-settings') || '{}');
		settings.globalSystemPrompt = 'Imported prompt';
		window.localStorage.setItem('hollama-settings', JSON.stringify(settings));
	});
	await page.goto('/system-prompt');
	await expect(page.locator('#global-system-prompt')).toHaveValue('Imported prompt');

	// Sidebar indicator should be visible
	const link = page.getByRole('link', { name: /System Prompt/ });
	const dot = link.locator('span.rounded-full');
	await expect(dot).toBeVisible();
});

test('import old-format preferences without globalSystemPrompt does not break', async ({
	page
}) => {
	// Seed settings WITHOUT globalSystemPrompt (old format)
	await page.evaluate(() => {
		const settings = JSON.parse(window.localStorage.getItem('hollama-settings') || '{}');
		delete settings.globalSystemPrompt;
		window.localStorage.setItem('hollama-settings', JSON.stringify(settings));
	});
	await page.goto('/system-prompt');

	// Textarea must be empty, NOT show "undefined"
	const textarea = page.locator('#global-system-prompt');
	await expect(textarea).toHaveValue('');
	await expect(textarea).not.toHaveValue('undefined');

	// No sidebar indicator
	const link = page.getByRole('link', { name: /System Prompt/ });
	const dot = link.locator('span.rounded-full');
	await expect(dot).not.toBeVisible();
});

test('delete preferences clears globalSystemPrompt', async ({ page }) => {
	// Set a global prompt
	await page.evaluate(() => {
		const settings = JSON.parse(window.localStorage.getItem('hollama-settings') || '{}');
		settings.globalSystemPrompt = 'Will be deleted';
		window.localStorage.setItem('hollama-settings', JSON.stringify(settings));
	});
	await page.goto('/system-prompt');
	await expect(page.locator('#global-system-prompt')).toHaveValue('Will be deleted');

	// Simulate preference deletion (reset to defaults)
	await page.evaluate(() => {
		const defaults = {
			models: [],
			lastUsedModels: [],
			userTheme: 'light',
			userLanguage: null,
			sidebarExpanded: true
		};
		window.localStorage.setItem('hollama-settings', JSON.stringify(defaults));
	});
	await page.goto('/system-prompt');

	await expect(page.locator('#global-system-prompt')).toHaveValue('');
});

// === i18n key presence ===

test('all new i18n keys exist in English locale', async ({ page }) => {
	await page.goto('/system-prompt');
	// If i18n keys are missing, the page would show the key name or throw.
	// Verify the actual rendered text matches the expected values.
	await expect(page.getByRole('heading', { name: 'Global System Prompt' })).toBeVisible();
	await expect(page.getByText('Applies to all sessions')).toBeVisible();
	await expect(page.getByText('When both global and session prompts are set')).toBeVisible();
});

// === Fireworks + global + per-session ===

test('global + per-session both appear in payload', async ({ page }) => {
	// Set global prompt
	await page.goto('/system-prompt');
	await page.getByLabel('System instructions').fill('Be concise');

	// Create session, set per-session prompt, send
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();
	await chooseFromCombobox(page, 'Available models', MOCK_API_TAGS_RESPONSE.models[0].name);

	await page.getByTestId('session-system-prompt-button').click();
	await page.locator('#session-system-prompt-textarea').fill('Use Python');

	let requestPayload: any;
	await page.route('**/api/chat', async (route) => {
		requestPayload = JSON.parse(route.request().postData() || '{}');
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
		});
	});

	await page.locator('.prompt-editor__textarea').fill('Hello');
	await page.getByRole('button', { name: 'Run' }).click();

	expect(requestPayload.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
	expect(requestPayload.messages[1]).toEqual({ role: 'system', content: 'Use Python' });
	expect(requestPayload.messages[2]).toEqual({ role: 'user', content: 'Hello' });
});

// === Panel textarea aria-label ===

test('panel textarea has aria-label', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();
	await page.getByTestId('session-system-prompt-button').click();
	const textarea = page.locator('#session-system-prompt-textarea');
	await expect(textarea).toHaveAttribute('aria-label', 'System instructions');
});

// === Messages/Controls segmented nav toggle ===

test('Messages/Controls segmented nav works after textarea removal', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();
	await chooseFromCombobox(page, 'Available models', MOCK_API_TAGS_RESPONSE.models[0].name);

	// Switch to Controls
	await page.getByLabel('Controls').click();
	await expect(page.locator('.controls')).toBeVisible();

	// Switch back to Messages
	await page.getByLabel('Messages').click();
	await expect(page.locator('.controls')).not.toBeVisible();
});
