import { expect, test } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	MOCK_SESSION_1_RESPONSE_3,
	MOCK_SESSION_2_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

test.describe('Multi-select delete', () => {
	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
	});

	test('deletes the currently-viewed session via multi-select without resurrecting it', async ({
		page
	}) => {
		// This is the highest-risk interaction for the resurrection bug:
		// batch-deleting a set of sessions that includes the one currently being
		// viewed must navigate away cleanly with no stale-reference re-insertion.
		const promptTextarea = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		// Create three sessions
		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await promptTextarea.fill('What does the fox say?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_3);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Write a function comparing two people');
		await page.getByText('Run').click();
		await expect(page.getByText('calculate_odds', { exact: false })).toBeVisible();

		expect(await page.getByTestId('session-item').count()).toBe(3);

		// View the middle session (the "fox" one)
		await page.getByTestId('session-item').filter({ hasText: 'What does the fox say' }).click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();

		// Enter multi-select mode via the first checkbox and select all three
		await page.getByTestId('session-item-draggable').first().hover();
		await page.getByTestId('session-select-checkbox').first().click();
		await expect(page.getByTestId('multi-select-toolbar')).toBeVisible();

		await page.getByTestId('multi-select-select-all').click();
		await expect(page.getByTestId('multi-select-count')).toHaveText('3 selected');

		page.on('dialog', async (dialog) => {
			expect(dialog.message()).toContain('3 conversations');
			await dialog.accept();
		});
		await page.getByTestId('multi-select-delete').click();

		// All three are gone, we're back on the sessions index, and nothing
		// was resurrected via a stale beforeNavigate/handleSessionChange reference.
		await expect(page).toHaveURL('/sessions');
		await expect(page.getByText('No sessions')).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(0);

		await page.reload();
		expect(await page.getByTestId('session-item').count()).toBe(0);
		await expect(page.getByText('No sessions')).toBeVisible();
	});

	test('deselecting the last item exits multi-select mode and restores navigation', async ({
		page
	}) => {
		const promptTextarea = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('First conversation');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await promptTextarea.fill('Second conversation');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(2);

		// Enter multi-select by checking the first item...
		await page.getByTestId('session-item-draggable').first().hover();
		await page.getByTestId('session-select-checkbox').first().click();
		await expect(page.getByTestId('multi-select-toolbar')).toBeVisible();

		// ...then deselect it. The mode must EXIT (previously it stayed stuck on
		// with an empty selection, which blocked navigating into conversations).
		await page.getByTestId('session-item-draggable').first().hover();
		await page.getByTestId('session-select-checkbox').first().click();
		await expect(page.getByTestId('multi-select-toolbar')).not.toBeVisible();

		// Clicking a conversation now navigates again instead of toggling selection.
		await page.getByTestId('session-item').first().click();
		await expect(page).toHaveURL(/\/sessions\/[a-z0-9]+$/);
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();
	});

	test('individual checkbox clicks keep every checkbox visually in sync', async ({ page }) => {
		const promptTextarea = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('First');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await promptTextarea.fill('Second');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(2);

		const checkboxes = page.getByTestId('session-select-checkbox');

		// Click the first checkbox → it must actually render checked (the desync
		// bug left it visually unchecked even though the row highlighted).
		await page.getByTestId('session-item-draggable').first().hover();
		await checkboxes.first().click();
		await expect(checkboxes.first()).toBeChecked();
		await expect(checkboxes.nth(1)).not.toBeChecked();

		// Click the second → BOTH must be checked (the bug left the first one
		// desynced once a second item was clicked).
		await checkboxes.nth(1).click();
		await expect(checkboxes.first()).toBeChecked();
		await expect(checkboxes.nth(1)).toBeChecked();

		// Deselect the first → only the second stays checked.
		await checkboxes.first().click();
		await expect(checkboxes.first()).not.toBeChecked();
		await expect(checkboxes.nth(1)).toBeChecked();
	});
});
