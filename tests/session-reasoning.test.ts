import { expect, test, type Locator } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_RESPONSE_WITH_REASONING,
	MOCK_STREAMED_THINK_TAGS,
	MOCK_STREAMED_THOUGHT_TAGS,
	mockCompletionResponse,
	mockOllamaModelsResponse,
	setupStreamedCompletionMock
} from './utils';

test.describe('Session reasoning tag handling', () => {
	let promptTextarea: Locator;

	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
		promptTextarea = page.locator('.prompt-editor__textarea');
	});

	test('handles standard <think> tags in responses', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();

		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await mockCompletionResponse(page, MOCK_RESPONSE_WITH_REASONING);
		await promptTextarea.fill('How should I test my code?');
		await page.getByText('Run').click();

		// Check that the main content is displayed without the think tags
		await expect(page.locator('article').last()).toContainText(
			'Here is how you can test your code effectively:'
		);

		// Verify tags aren't visible
		await expect(page.getByText('<think>')).not.toBeVisible();
		await expect(page.getByText('</think>')).not.toBeVisible();

		// Check that reasoning indicator exists but reasoning is not initially visible
		await expect(page.locator('.reasoning')).toBeVisible();
		await expect(page.locator('.article--reasoning')).not.toBeVisible();

		// Check reasoning content and toggle
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		await expect(page.locator('.article--reasoning')).toBeVisible();
		await expect(page.locator('.article--reasoning')).toHaveText(
			'Let me analyze this request carefully. The user is asking about code testing, which requires a structured response.'
		);

		// Toggle off the reasoning
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		await expect(page.locator('.article--reasoning')).not.toBeVisible();

		// Verify the response structure when copying - should not include tags or reasoning
		await page.locator('.session__history').getByTitle('Copy').last().click();
		const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
		expect(clipboardText).toBe(
			'Here is how you can test your code effectively:\n\n1. Write unit tests\n2. Use integration tests\n3. Implement end-to-end testing'
		);
	});

	test('handles streamed <think> tags (character by character)', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();

		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

		// Set up fake streaming for the tests
		await setupStreamedCompletionMock(page, { chunks: MOCK_STREAMED_THINK_TAGS });

		// Now fill and submit the prompt
		await promptTextarea.fill('How should I test my code?');
		await page.getByText('Run').click();

		// Wait for the reasoning button to appear, indicating the reasoning tag was processed
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();

		// At this point, the reasoning content should be streaming in, but the final part should not yet be visible
		await expect(page.locator('.article--assistant')).not.toContainText('This is outside a tag');

		// Wait for the completion to finish - it will show "This is outside a tag" at the end
		await expect(page.locator('.article--assistant')).toBeVisible();

		// Wait for all streaming chunks to complete. This is a locator assertion
		// (polled via CDP), NOT page.waitForFunction — the app's strict privacy
		// CSP (`script-src 'self'` with no `unsafe-eval`) refuses waitForFunction's
		// in-page eval poller whenever the predicate isn't already true on the
		// first check (exactly the char-by-char streaming case). Same intent:
		// block until the assistant article contains the post-tag final text.
		await expect(page.locator('.article--assistant')).toContainText('This is outside a tag');

		// Now test that tags are stripped
		await expect(page.getByText('<think>')).not.toBeVisible();
		await expect(page.getByText('</think>')).not.toBeVisible();

		// Check reasoning button and content
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		await expect(page.locator('.article--reasoning')).toBeVisible();
		await expect(page.locator('.article--reasoning')).toHaveText('This is in a thinking tag');
	});

	test('reasoning block is open by default while reasoning is streaming, then auto-hides when main content starts', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();

		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await expect(page.getByText('This is in a thinking tag')).not.toBeVisible();

		// Use the manual streaming mock
		const stream = await setupStreamedCompletionMock(page, { manual: true });
		if (!stream)
			throw new Error('setupStreamedCompletionMock did not return a stream object in manual mode');

		await promptTextarea.fill('How should I test my code?');
		await page.getByText('Run').click();

		// Stream the reasoning content (simulate streaming <think>...</think>)
		const reasoningContent = '<think>This is in a thinking tag</think>';
		stream.sendChunk(reasoningContent, false);
		await expect(page.getByText('This is in a thinking tag')).toBeVisible();

		// Now stream the rest of the completion (simulate streaming main content)
		const completionContent = 'This is outside a tag';
		stream.sendChunk(completionContent, true);

		// Wait for the main content to appear
		await page.waitForFunction(() => {
			const el = document.querySelector('.article--assistant');
			return el && el.textContent && el.textContent.includes('This is outside a tag');
		});

		// Assert the reasoning block is now removed from the DOM
		await expect(page.locator('.article--reasoning')).toHaveCount(0);
		await expect(page.getByText('This is in a thinking tag')).not.toBeVisible();
	});

	test('handles streamed <thought> tags (character by character)', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();

		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

		// Set up fake streaming for the tests
		await setupStreamedCompletionMock(page, { chunks: MOCK_STREAMED_THOUGHT_TAGS });

		// Now fill and submit the prompt
		await promptTextarea.fill('How should I test my code?');
		await page.getByText('Run').click();

		// Wait for the reasoning button to appear, indicating the reasoning tag was processed
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();

		// At this point, the reasoning content should be streaming in, but the final part should not yet be visible
		await expect(page.locator('.article--assistant')).not.toContainText('This is outside a tag');

		// Wait for the completion to finish - it will show "This is outside a tag" at the end
		await expect(page.locator('.article--assistant')).toBeVisible();

		// Wait for all streaming chunks to complete. This is a locator assertion
		// (polled via CDP), NOT page.waitForFunction — the app's strict privacy
		// CSP (`script-src 'self'` with no `unsafe-eval`) refuses waitForFunction's
		// in-page eval poller whenever the predicate isn't already true on the
		// first check (exactly the char-by-char streaming case). Same intent:
		// block until the assistant article contains the post-tag final text.
		await expect(page.locator('.article--assistant')).toContainText('This is outside a tag');

		// Now test that tags are stripped
		await expect(page.getByText('<thought>')).not.toBeVisible();
		await expect(page.getByText('</thought>')).not.toBeVisible();

		// Check reasoning button and content
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		await expect(page.locator('.article--reasoning')).toBeVisible();
		await expect(page.locator('.article--reasoning')).toHaveText('This is in a thought tag');
	});

	test('does not show reasoning components for non-reasoning LLM response', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();

		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Give me a normal answer.');
		await expect(page.getByText('Run')).toBeEnabled();

		await mockCompletionResponse(page, {
			model: MOCK_API_TAGS_RESPONSE.models[0].name,
			created_at: new Date(),
			message: {
				role: 'assistant',
				content: 'This is just a normal answer.'
			},
			done: true,
			done_reason: 'stop',
			total_duration: 1000,
			load_duration: 1000,
			prompt_eval_count: 1,
			prompt_eval_duration: 1,
			eval_count: 1,
			eval_duration: 1
		});
		await page.getByText('Run').click();

		// Wait for the main content to appear
		await expect(page.getByText('This is just a normal answer.')).toBeVisible();

		// Assert that there are no visible reasoning components
		await expect(page.locator('.reasoning')).toHaveCount(0);
		await expect(page.locator('.article--reasoning')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toHaveCount(0);
	});

	test('reasoning toggle is available for Ollama and sends think:true when enabled', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

		// The reasoning toggle shows for Ollama (no longer gated to Fireworks).
		const reasoningToggle = page.getByTestId('reasoning-toggle');
		await expect(reasoningToggle).toBeVisible();
		await reasoningToggle.click();

		let payload: Record<string, unknown> = {};
		await page.route('**/api/chat', async (route) => {
			payload = JSON.parse(route.request().postData() || '{}');
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					model: 'm',
					message: { role: 'assistant', content: 'ok' },
					done: true
				})
			});
		});
		await promptTextarea.fill('Think about this');
		await page.getByText('Run').click();
		await expect(page.locator('.article--assistant')).toContainText('ok');

		// Ollama's native thinking is requested; the OpenAI reasoningEffort param is not leaked.
		expect(payload.think).toBe(true);
		expect(payload.reasoningEffort).toBeUndefined();
	});

	test('Ollama native thinking field renders as a reasoning trace', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByTestId('reasoning-toggle').click();

		// A streamed Ollama NDJSON response carrying the native `thinking` field
		// (separate from content) — not inline <think> tags.
		const ndjson =
			[
				JSON.stringify({
					model: 'm',
					message: {
						role: 'assistant',
						content: '',
						thinking: 'Let me reason about this carefully.'
					},
					done: false
				}),
				JSON.stringify({
					model: 'm',
					message: { role: 'assistant', content: 'The answer is 42.' },
					done: false
				}),
				JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true })
			].join('\n') + '\n';
		await page.route('**/api/chat', (route) =>
			route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson })
		);

		await promptTextarea.fill('What is the answer?');
		await page.getByText('Run').click();

		// Main content rendered; the thinking field surfaced as a reasoning trace.
		await expect(page.locator('.article--assistant')).toContainText('The answer is 42.');
		await expect(page.getByRole('button', { name: 'Reasoning', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		await expect(page.locator('.article--reasoning')).toContainText(
			'Let me reason about this carefully.'
		);
	});

	test('reasoning OFF (default) does not send think to Ollama', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		// Do NOT enable the reasoning toggle — off must mean off.

		let payload: Record<string, unknown> = {};
		await page.route('**/api/chat', async (route) => {
			payload = JSON.parse(route.request().postData() || '{}');
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					model: 'm',
					message: { role: 'assistant', content: 'ok' },
					done: true
				})
			});
		});
		await promptTextarea.fill('Hi');
		await page.getByText('Run').click();
		await expect(page.locator('.article--assistant')).toContainText('ok');

		expect(payload.think).toBeUndefined();
		expect(payload.reasoningEffort).toBeUndefined();
	});

	test('reasoning on a non-capable model degrades: retries without it and warns', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByTestId('reasoning-toggle').click();

		const thinkSeen: boolean[] = [];
		await page.route('**/api/chat', async (route) => {
			const body = JSON.parse(route.request().postData() || '{}');
			thinkSeen.push(body.think === true);
			if (body.think) {
				// First attempt: the model rejects native thinking.
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'model does not support thinking' })
				});
			} else {
				// Retry without reasoning succeeds.
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						model: 'm',
						message: { role: 'assistant', content: 'plain answer' },
						done: true
					})
				});
			}
		});
		await promptTextarea.fill('Hi');
		await page.getByText('Run').click();

		// User still gets a usable response (the retry without reasoning)...
		await expect(page.locator('.article--assistant')).toContainText('plain answer');
		// ...plus a clear notice that reasoning was dropped.
		await expect(page.getByText('may not support reasoning', { exact: false })).toBeVisible();
		// Exactly two attempts: first WITH think, then WITHOUT.
		expect(thinkSeen).toEqual([true, false]);
	});

	test('a truncated final NDJSON frame surfaces an error, not a silent empty completion', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

		// A valid first line, then a truncated (unparseable) final fragment with no
		// trailing newline → the stream-end flush must throw, not commit silently.
		const ndjson =
			JSON.stringify({
				model: 'm',
				message: { role: 'assistant', content: 'partial' },
				done: false
			}) +
			'\n' +
			'{"model":"m","message":{"role":"assistant","content":"tr';
		await page.route('**/api/chat', (route) =>
			route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson })
		);
		await promptTextarea.fill('Hi');
		await page.getByText('Run').click();

		await expect(page.getByText('something went wrong', { exact: false })).toBeVisible();
	});

	test('Ollama thinking in an unterminated final frame renders (stream-end path)', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByTestId('reasoning-toggle').click();

		// Single frame, done:true, WITH thinking, and NO trailing newline → this is
		// handled entirely by the stream-end flush, not the mid-stream loop.
		const body = JSON.stringify({
			model: 'm',
			message: { role: 'assistant', content: 'Answer.', thinking: 'end-buffer reasoning' },
			done: true
		});
		await page.route('**/api/chat', (route) =>
			route.fulfill({ status: 200, contentType: 'application/x-ndjson', body })
		);
		await promptTextarea.fill('Hi');
		await page.getByText('Run').click();

		await expect(page.locator('.article--assistant')).toContainText('Answer.');
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		await expect(page.locator('.article--reasoning')).toContainText('end-buffer reasoning');
	});

	test('reasoning enabled but the model returns no trace warns (lenient-ignore dead toggle)', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByTestId('reasoning-toggle').click();

		// Success, content only, NO thinking/reasoning — a lenient server that
		// silently ignored the reasoning param (no error to catch).
		await page.route('**/api/chat', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					model: 'm',
					message: { role: 'assistant', content: 'plain answer, no reasoning' },
					done: true
				})
			})
		);
		await promptTextarea.fill('Hi');
		await page.getByText('Run').click();

		await expect(page.locator('.article--assistant')).toContainText('plain answer, no reasoning');
		// The dead toggle is now surfaced instead of silently doing nothing.
		await expect(page.getByText('may not support reasoning', { exact: false })).toBeVisible();
	});

	test('native thinking + inline <think> are both surfaced, not silently dropped', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByTestId('reasoning-toggle').click();

		// Pathological response carrying BOTH a native `thinking` field AND an
		// inline <think> tag in content. hollama can't know whether they're
		// duplicates, so it surfaces both reasoning sources rather than silently
		// dropping either — this pins that documented behavior (was untested).
		const ndjson =
			[
				JSON.stringify({
					model: 'm',
					message: { role: 'assistant', content: '', thinking: 'native reasoning' },
					done: false
				}),
				JSON.stringify({
					model: 'm',
					message: { role: 'assistant', content: '<think>tag reasoning</think>Answer.' },
					done: false
				}),
				JSON.stringify({ model: 'm', message: { role: 'assistant', content: '' }, done: true })
			].join('\n') + '\n';
		await page.route('**/api/chat', (route) =>
			route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: ndjson })
		);
		await promptTextarea.fill('Hi');
		await page.getByText('Run').click();

		await expect(page.locator('.article--assistant')).toContainText('Answer.');
		await page.getByRole('button', { name: 'Reasoning', exact: true }).click();
		const reasoning = page.locator('.article--reasoning');
		await expect(reasoning).toContainText('native reasoning');
		await expect(reasoning).toContainText('tag reasoning');
	});
});
