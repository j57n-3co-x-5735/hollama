import { expect, test } from '@playwright/test';

import {
	chooseFromCombobox,
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_KNOWLEDGE,
	MOCK_SESSION_WITH_KNOWLEDGE_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse,
	seedKnowledgeAndReload
} from './utils';

// Regression coverage for the Svelte 4 / Svelte 5 binding boundary.
// KnowledgeSelect was migrated to Svelte 5
// $props()/$bindable(), but it wraps FieldSelect, which is still
// Svelte 4 `export let value`. The only site that drives this boundary in BOTH
// directions is the two-way `bind:value` in Controls.svelte (knowledge as a
// session system prompt) — the prompt-area KnowledgeSelect is one-way
// (`value=` + `onChange`) and does not exercise the reverse propagation.
//
// Three behaviors across this boundary are all covered below in one flow:
//   1. selecting an entry updates the bound state (and reaches the request),
//   2. clearing resets the bound value to undefined,
//   3. the selection tracks per-session across navigation (no sticky leak).
test.describe('KnowledgeSelect Svelte 4/5 binding boundary', () => {
	test('selects, clears, and tracks knowledge per session', async ({ page }) => {
		const knowledgeInput = page.getByLabel('Knowledge', { exact: true });
		// The clear "X" only renders while FieldSelect's derived `selected?.value`
		// is truthy — i.e. while the bound `value` holds a real option id. Its
		// visibility is therefore a direct, reactive readout of the cross-boundary
		// binding, independent of combobox display cosmetics.
		const knowledgeClear = page.locator('.field-select-input:has(#knowledge)').getByTitle('Clear');

		await mockOllamaModelsResponse(page);
		await page.goto('/');
		await seedKnowledgeAndReload(page);

		// --- 1. SELECT: choosing an entry propagates FieldSelect -> $bindable ---
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByLabel('Controls').click();
		await chooseFromCombobox(page, 'Knowledge', MOCK_KNOWLEDGE[0].name);
		await expect(knowledgeClear).toBeVisible();
		await expect(knowledgeInput).toHaveAttribute('placeholder', MOCK_KNOWLEDGE[0].name);

		// Full-chain proof: the bound value reaches the outgoing request as the
		// system prompt (value -> knowledgeId -> session.systemPrompt.content).
		let requestPostData: string | null = null;
		page.on('request', (request) => {
			if (request.url().includes('/api/chat')) requestPostData = request.postData();
		});
		await mockCompletionResponse(page, MOCK_SESSION_WITH_KNOWLEDGE_RESPONSE_1);
		await page.locator('.prompt-editor__textarea').fill('Tell me about the transcript');
		await page.locator('button', { hasText: 'Run' }).click();
		await expect(page.locator('.session__history .article')).toHaveCount(2);
		// The selected knowledge's content reached the outgoing request as the
		// system message — proof the value propagated the full chain across the
		// Svelte 4/5 boundary. (We assert only the system message; the message
		// serialization intentionally carries no extra `knowledge` metadata
		// field.)
		expect(requestPostData).toContain(
			JSON.stringify({ role: 'system', content: MOCK_KNOWLEDGE[0].content })
		);

		// --- 3. SWITCH (tracks per session, no leak): while session A still holds
		// the selection, a fresh session B must initialize to its own empty state
		// and NOT inherit A's bound value across the boundary. ---
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await page.getByLabel('Controls').click();
		await expect(knowledgeClear).toBeHidden();

		// --- 2. CLEAR: selecting then clearing resets the bound value to undefined.
		// Done in session B so B independently exercises the select -> clear path. ---
		await chooseFromCombobox(page, 'Knowledge', MOCK_KNOWLEDGE[1].name);
		await expect(knowledgeClear).toBeVisible();
		await expect(knowledgeInput).toHaveAttribute('placeholder', MOCK_KNOWLEDGE[1].name);
		await knowledgeClear.click();
		await expect(knowledgeClear).toBeHidden();
	});
});
