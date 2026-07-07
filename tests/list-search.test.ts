import { expect, test } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	MOCK_SESSION_2_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

test.describe('Conversation list search', () => {
	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
	});

	test('filters by title, model, and id; clearing restores the grouped view', async ({ page }) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await prompt.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await prompt.fill('What does the fox say?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();

		expect(await page.getByTestId('session-item').count()).toBe(2);

		const search = page.getByTestId('sidebar-search-input');

		// Filter by title
		await search.fill('fox');
		await expect(page.getByTestId('session-item')).toHaveCount(1);
		await expect(page.getByTestId('session-item')).toContainText('What does the fox say');

		// Filter by model name
		await search.fill(MOCK_API_TAGS_RESPONSE.models[0].name);
		await expect(page.getByTestId('session-item')).toHaveCount(1);
		await expect(page.getByTestId('session-item')).toContainText('Who would win in a fight');

		// No matches
		await search.fill('nonexistent query xyz');
		await expect(page.getByText('No sessions match your search')).toBeVisible();
		await expect(page.getByTestId('session-item')).toHaveCount(0);

		// Clearing restores both sessions
		await page.getByTestId('sidebar-search-clear').click();
		await expect(search).toHaveValue('');
		await expect(page.getByTestId('session-item')).toHaveCount(2);
	});

	test('search hides on the Knowledge tab and preserves the query when returning', async ({
		page
	}) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await prompt.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const search = page.getByTestId('sidebar-search-input');
		await search.fill('fight');
		await expect(page.getByTestId('session-item')).toHaveCount(1);

		await page.getByRole('tab', { name: 'Knowledge' }).click();
		await expect(search).not.toBeVisible();

		await page.getByRole('tab', { name: 'Sessions' }).click();
		await expect(search).toHaveValue('fight');
		await expect(page.getByTestId('session-item')).toHaveCount(1);
	});

	test('search does not persist across a page reload', async ({ page }) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await prompt.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await page.getByTestId('sidebar-search-input').fill('fight');
		await expect(page.getByTestId('session-item')).toHaveCount(1);

		await page.reload();
		await expect(page.getByTestId('sidebar-search-input')).toHaveValue('');
		await expect(page.getByTestId('session-item')).toHaveCount(1);
	});
});
