import { expect, test } from '@playwright/test';

import type { Model } from '$lib/settings';
import { generateRandomId } from '$lib/utils';

import {
	MOCK_API_TAGS_RESPONSE,
	MOCK_KNOWLEDGE,
	mockOllamaModelsResponse,
	seedKnowledgeAndReload
} from './utils';

test.beforeEach(async ({ page }) => {
	await mockOllamaModelsResponse(page);
});

test('seed data and take screenshots for README.md', async ({ page }) => {
	await page.goto('/settings');

	await expect(page.getByTestId('server')).toHaveCount(1);
	expect(await page.screenshot()).toMatchSnapshot({ name: 'settings.png' });

	await page.goto('/sessions/ulxz6l');
	await expect(page.getByText('No sessions')).toBeVisible();
	await expect(page.locator('.prompt-editor__textarea')).toBeVisible();
	await expect(page.locator('.text-editor')).not.toBeVisible();

	await page.locator('.prompt-editor__toggle').click();
	await expect(page.locator('.text-editor')).toBeVisible();
	await expect(page.locator('.prompt-editor__textarea')).not.toBeVisible();
	expect(await page.screenshot()).toMatchSnapshot({ name: 'session-new.png' });

	// --- Seed folders + sessions ---
	const models: Model[] = MOCK_API_TAGS_RESPONSE.models.map((model) => ({
		name: model.name,
		serverId: generateRandomId()
	}));

	const folderId1 = generateRandomId();
	const folderId2 = generateRandomId();

	await page.evaluate(
		(data) => window.localStorage.setItem('hollama-folders', JSON.stringify(data)),
		[
			{
				id: folderId1,
				name: 'Work',
				isExpanded: true,
				sortOrder: 0,
				updatedAt: new Date().toISOString()
			},
			{
				id: folderId2,
				name: 'Personal',
				isExpanded: true,
				sortOrder: 1,
				updatedAt: new Date().toISOString()
			}
		]
	);

	await page.evaluate(
		({ modelA, modelB, modelC, folderId1, folderId2 }) =>
			window.localStorage.setItem(
				'hollama-sessions',
				JSON.stringify([
					{
						id: 'u4pozr',
						model: modelA,
						folderId: folderId1,
						messages: [
							{
								role: 'user',
								content:
									'Write a Python function to calculate the odds of the winner in a fight between Emma Watson and Jessica Alba'
							},
							{
								role: 'assistant',
								content:
									"Here's a basic function that takes the age, height, weight, and fighting experience of both individuals as input and returns the difference between their ages, heights, and weights.\n```python\ndef calculate_odds(emma_age, emma_height, emma_weight, emma_experience, jessica_age, jessica_height, jessica_weight, jessica_experience):\n    emma_stats = {'age': emma_age, 'height': emma_height, 'weight': emma_weight, 'experience': emma_experience}\n    jessica_stats = {'age': jessica_age, 'height': jessica_height, 'weight': jessica_weight, 'experience': jessica_experience}\n    \n    # Calculate the differences between their stats\n    age_difference = abs(emma_stats['age'] - jessica_stats['age'])\n    height_difference = abs(emma_stats['height'] - jessica_stats['height'])\n    weight_difference = abs(emma_stats['weight'] - jessica_stats['weight'])\n    \n    # Return the differences as a tuple\n    return (age_difference, height_difference, weight_difference)\n```\nYou can use this function to compare Emma Watson and Jessica Alba by providing their respective statistics as inputs."
							}
						],
						updatedAt: new Date().toISOString()
					},
					{
						id: 'bbpz8o',
						model: modelB,
						folderId: folderId1,
						messages: [
							{
								role: 'user',
								content: 'What is the meaning of life?'
							},
							{
								role: 'assistant',
								content:
									'**The meaning of life is a complex and multifaceted question that has been pondered by philosophers, theologians, and individuals throughout history.** Good luck with that.'
							}
						],
						updatedAt: new Date().toISOString()
					},
					{
						id: 'ck9d3w',
						model: modelC,
						folderId: folderId2,
						messages: [
							{
								role: 'user',
								content: 'Explain how quicksort works'
							},
							{
								role: 'assistant',
								content:
									'Quicksort is a divide-and-conquer sorting algorithm. It works by selecting a **pivot** element from the array and partitioning the other elements into two sub-arrays:\n\n1. Elements **less than** the pivot\n2. Elements **greater than** the pivot\n\nThe sub-arrays are then sorted recursively.\n\n```javascript\nfunction quicksort(arr) {\n  if (arr.length <= 1) return arr;\n  const pivot = arr[0];\n  const left = arr.slice(1).filter(x => x <= pivot);\n  const right = arr.slice(1).filter(x => x > pivot);\n  return [...quicksort(left), pivot, ...quicksort(right)];\n}\n```\n\nAverage time complexity: **O(n log n)**'
							}
						],
						updatedAt: new Date().toISOString()
					}
				])
			),
		{
			modelA: models[0],
			modelB: models[1],
			modelC: models[2] ?? models[0],
			folderId1,
			folderId2
		}
	);

	await page.reload();
	await expect(page.getByText('No sessions')).not.toBeVisible();

	// Session with code block — folders visible in sidebar
	await page.getByText('Write a Python function').click();
	await expect(page.getByText("Here's a basic function")).toBeVisible();
	await page.locator('article', { hasText: "Here's a basic function" }).hover();
	expect(await page.screenshot()).toMatchSnapshot({ name: 'session.png' });

	// In-conversation search
	await page.getByTestId('session-search-toggle').click();
	await expect(page.getByTestId('in-conversation-search-input')).toBeVisible();
	await page.getByTestId('in-conversation-search-input').fill('function');
	await expect(page.getByTestId('in-conversation-search-counter')).not.toHaveText('');
	expect(await page.screenshot()).toMatchSnapshot({ name: 'session-search.png' });
	await page.getByTestId('in-conversation-search-close').click();

	// Controls view
	await page.getByLabel('Controls').click();
	await expect(page.getByText('System prompt')).toBeVisible();
	expect(await page.screenshot()).toMatchSnapshot({ name: 'session-controls.png' });

	// Knowledge
	await page.getByRole('tab', { name: 'Knowledge' }).click();
	await expect(page.getByText('No knowledge')).toBeVisible();

	await seedKnowledgeAndReload(page);
	await expect(page.getByText('No knowledge')).not.toBeVisible();
	await expect(page.getByTestId('knowledge-metadata')).not.toBeVisible();

	await page.getByText(MOCK_KNOWLEDGE[0].name).click();
	await expect(page.getByTestId('knowledge-metadata')).toBeVisible();
	expect(await page.screenshot()).toMatchSnapshot({ name: 'knowledge.png' });
});
