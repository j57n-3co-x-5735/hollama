import { expect, test } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

test.describe('In-conversation search', () => {
	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
	});

	test('finds matches, highlights them, and navigates between them', async ({ page }) => {
		const promptTextarea = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		// Open search and look for a word that appears in both messages: "or"
		// appears in "fight" (no) — use "provide" which is unique to the
		// assistant response, and "fight" which is unique to the user prompt.
		await page.getByTestId('session-search-toggle').click();
		const searchInput = page.getByTestId('in-conversation-search-input');
		await expect(searchInput).toBeFocused();

		await searchInput.fill('unable to provide');
		await expect(page.getByTestId('in-conversation-search-counter')).toHaveText('1 of 1 matches');
		await expect(page.locator('mark.search-highlight')).toHaveCount(1);
		await expect(page.locator('mark.search-highlight--active')).toHaveText('unable to provide');

		// A query matching both messages navigates between them
		await searchInput.fill('a');
		const matchCount = await page.locator('mark.search-highlight').count();
		expect(matchCount).toBeGreaterThan(1);

		await expect(page.getByTestId('in-conversation-search-counter')).toHaveText(
			`1 of ${matchCount} matches`
		);
		await page.getByTestId('in-conversation-search-next').click();
		await expect(page.getByTestId('in-conversation-search-counter')).toHaveText(
			`2 of ${matchCount} matches`
		);
		await page.getByTestId('in-conversation-search-prev').click();
		await expect(page.getByTestId('in-conversation-search-counter')).toHaveText(
			`1 of ${matchCount} matches`
		);

		// A query with no matches shows the empty state and no highlights
		await searchInput.fill('xyznonexistentquery');
		await expect(page.getByTestId('in-conversation-search-counter')).toHaveText('No results found');
		await expect(page.locator('mark.search-highlight')).toHaveCount(0);

		// Closing search clears all highlights
		await searchInput.fill('a');
		await expect(page.locator('mark.search-highlight').first()).toBeVisible();
		await page.getByTestId('in-conversation-search-close').click();
		await expect(page.getByTestId('in-conversation-search')).not.toBeVisible();
		await expect(page.locator('mark.search-highlight')).toHaveCount(0);
	});

	test('highlights a match that spans multiple text nodes (across inline formatting)', async ({
		page
	}) => {
		const promptTextarea = page.locator('.prompt-editor__textarea');
		const boldResponse = {
			...MOCK_SESSION_1_RESPONSE_1,
			message: {
				role: 'assistant' as const,
				// markdown-it renders **brown** as a separate <strong> element, so
				// "quick brown" straddles the plain text node "The quick " and the
				// bold text node "brown" — the multi-node highlighting path.
				content: 'The quick **brown** fox jumps.'
			}
		};

		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await mockCompletionResponse(page, boldResponse);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Give me a sentence');
		await page.getByText('Run').click();
		// Wait for render, incl. the bold rendered as its own element.
		await expect(page.getByText('fox jumps')).toBeVisible();
		await expect(page.locator('.markdown strong', { hasText: 'brown' })).toBeVisible();

		await page.getByTestId('session-search-toggle').click();
		await page.getByTestId('in-conversation-search-input').fill('quick brown');

		const marks = page.locator('mark.search-highlight');
		// One <mark> per text node the match touches — a single element can't
		// span the DOM fork the <strong> introduces. Two marks whose text
		// concatenates back to the query proves the span was stitched correctly.
		await expect(marks).toHaveCount(2);
		expect((await marks.allTextContents()).join('')).toBe('quick brown');
		// The bold half of the match is highlighted inside the <strong>.
		await expect(page.locator('.markdown strong mark.search-highlight')).toHaveText('brown');
	});

	test('does not search within code blocks', async ({ page }) => {
		const promptTextarea = page.locator('.prompt-editor__textarea');
		const codeResponse = {
			...MOCK_SESSION_1_RESPONSE_1,
			message: {
				role: 'assistant' as const,
				content: 'Here is some text.\n\n```python\ndef example():\n    return "text"\n```\n\nMore text here.'
			}
		};

		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await mockCompletionResponse(page, codeResponse);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Give me an example function');
		await page.getByText('Run').click();
		await expect(page.getByText('More text here.')).toBeVisible();

		await page.getByTestId('session-search-toggle').click();
		await page.getByTestId('in-conversation-search-input').fill('text');

		// "text" appears 3 times in prose ("some text", "More text here") but
		// also inside the code block ("text") — only prose matches should highlight.
		const highlightedTexts = await page.locator('mark.search-highlight').allTextContents();
		for (const text of highlightedTexts) {
			expect(text.toLowerCase()).toBe('text');
		}
		// Verify none of the highlights are inside the <pre><code> block
		const highlightsInCode = await page.locator('pre code mark.search-highlight').count();
		expect(highlightsInCode).toBe(0);
	});
});
