import { expect, test } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	mockOllamaModelsResponse,
	setupStreamedCompletionMock
} from './utils';

// Two session edge cases that must degrade gracefully: sending from a session
// whose model server was removed, and leaving a never-persisted session
// mid-completion.
test.describe('Session edge cases', () => {
	test('a session whose model server was removed fails gracefully at send', async ({
		page
	}) => {
		await page.goto('/');
		// Seed a session referencing a model on a server that no longer exists.
		// The model-sync guard deliberately preserves the stale model (so its name
		// survives while models are still loading), which keeps Run enabled.
		await page.evaluate(() => {
			window.localStorage.setItem('hollama-servers', JSON.stringify([]));
			window.localStorage.setItem(
				'hollama-settings',
				JSON.stringify({ models: [], lastUsedModels: [] })
			);
			window.localStorage.setItem(
				'hollama-sessions',
				JSON.stringify([
					{
						id: 'stale01',
						model: { name: 'ghost-model', serverId: 'removed-server' },
						updatedAt: '2024-09-24T14:24:30.725Z',
						messages: [],
						options: {},
						systemPrompt: { role: 'system', content: '' }
					}
				])
			);
		});
		await page.goto('/sessions/stale01');

		await page.locator('.prompt-editor__textarea').fill('Hello');
		const run = page.getByText('Run');
		await expect(run).toBeEnabled();
		await run.click();

		// Graceful: a clear "Server not found" error, no crash, no assistant message.
		await expect(page.getByText('Server not found', { exact: false })).toBeVisible();
		await expect(page.locator('.article--assistant')).toHaveCount(0);
	});

	test('leaving a never-persisted session mid-completion prompts before dropping it', async ({
		page
	}) => {
		await mockOllamaModelsResponse(page);
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

		const stream = await setupStreamedCompletionMock(page, { manual: true });
		if (!stream) throw new Error('manual stream mock unavailable');
		await page.locator('.prompt-editor__textarea').fill('Hello');
		await page.getByText('Run').click();
		stream.sendChunk('partial', false); // in-flight, not done
		await expect(page.locator('.article--assistant')).toContainText('partial');

		// Navigating away from an in-flight NEW session must PROMPT (not silently
		// drop it, and not silently materialize it without asking). Accept → stop.
		let prompted = false;
		page.on('dialog', (dialog) => {
			prompted = true;
			dialog.accept();
		});
		await page.getByRole('tab', { name: 'Knowledge' }).click();
		await expect.poll(() => prompted).toBe(true);
	});
});
