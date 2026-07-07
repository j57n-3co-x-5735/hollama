import { expect, test } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

// Item 4: the header buttons are provider-independent — copy/export is shown in
// every state (it was never Fireworks-gated; the reported symptom was the
// empty-session gate). Search is provider-independent too, but only rendered
// where it can actually work (canSearch = messages view with >=1 message): the
// controls view has no messages container and an empty chat has nothing to find,
// so an ungated search button there would open a dead, unbound bar.

const OLLAMA_SESSION = [
	{
		id: 'hdr-test',
		model: { name: 'gemma:7b', serverId: 'default' },
		updatedAt: '2024-09-24T14:24:30.725Z',
		messages: [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'hello there' }
		],
		options: {},
		systemPrompt: { role: 'system', content: '' }
	}
];

test.describe('session header buttons', () => {
	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
	});

	test('search + copy/export show for an Ollama session with messages', async ({ page }) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await prompt.fill('Hello from Ollama');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await expect(page.getByTestId('session-search-toggle')).toBeVisible();
		await expect(page.getByTestId('session-copy-button')).toBeVisible();
	});

	test('copy/export shows on an empty session, but search is hidden (nothing to find)', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();

		// Copy/export is state-independent → present.
		await expect(page.getByTestId('session-copy-button')).toBeVisible();
		// Search has nothing to act on yet → not rendered (no dead box).
		await expect(page.getByTestId('session-search-toggle')).toHaveCount(0);
	});

	test('the magnifier opens a working in-conversation search (highlights a match)', async ({
		page
	}) => {
		await page.goto('/');
		await page.evaluate(
			(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
			OLLAMA_SESSION
		);
		await page.reload();
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('session-item').first().click();
		await expect(page.getByText('hello there')).toBeVisible();

		await page.getByTestId('session-search-toggle').click();
		const searchInput = page.getByTestId('in-conversation-search-input');
		await expect(searchInput).toBeVisible();
		await searchInput.fill('hello');

		// A real match is highlighted — proves the search is wired, not just visible.
		await expect(page.locator('mark.search-highlight').first()).toBeVisible();
	});

	test('search is hidden in the controls view (no dead search box); copy/export stays', async ({
		page
	}) => {
		await page.goto('/');
		await page.evaluate(
			(data) => window.localStorage.setItem('hollama-sessions', JSON.stringify(data)),
			OLLAMA_SESSION
		);
		await page.reload();
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('session-item').first().click();

		// Messages view: search is available.
		await expect(page.getByTestId('session-search-toggle')).toBeVisible();

		// Switch to the Advanced Controls view (needs a selected Ollama model).
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByLabel('Controls').click();
		await expect(page.locator('.controls')).toBeVisible();

		// Search must NOT render here — the controls view has no messages container,
		// so the button would open a dead, unbound search bar (Finding 1). Copy/export
		// stays, since it is view-independent.
		await expect(page.getByTestId('session-search-toggle')).toHaveCount(0);
		await expect(page.getByTestId('session-copy-button')).toBeVisible();
	});
});
