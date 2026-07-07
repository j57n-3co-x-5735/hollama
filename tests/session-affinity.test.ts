import { expect, test } from '@playwright/test';

/**
 * Session affinity key — conditional rendering + auto-clear on type change.
 *
 * The sessionAffinityKey input in Connection.svelte is rendered ONLY when
 * `server.connectionType === 'openai-compatible'`. A defensive `$effect`
 * also clears the value to `undefined` whenever the type is not
 * openai-compatible — including initial render.
 *
 * Test strategy:
 *  - Seed localStorage with various connectionType × sessionAffinityKey
 *    combinations and verify the rendered DOM does/doesn't include the
 *    input.
 *  - For the auto-clear effect: seed an OpenAI server with a non-empty
 *    sessionAffinityKey (the case sanitizeImportedServer would have rejected
 *    but a manual JSON edit or older version could produce), and verify
 *    the effect runs and clears it on initial render.
 */

const TEST_SERVER_ID = 'session-affinity-test-server';

function seed(connectionType: string, sessionAffinityKey: string | undefined) {
	return {
		id: TEST_SERVER_ID,
		baseUrl: 'https://api.example.com/v1',
		connectionType,
		isVerified: new Date().toISOString(),
		isEnabled: true,
		sessionAffinityKey
	};
}

test.describe('sessionAffinityKey - conditional rendering', () => {
	test('visible when connectionType is openai-compatible and key is set', async ({
		page
	}) => {
		await page.addInitScript((server) => {
			localStorage.setItem('hollama-servers', JSON.stringify([server]));
		}, seed('openai-compatible', 'hollama-session-1'));

		await page.goto('/settings');
		// Find the input by its unique placeholder.
		const input = page.getByPlaceholder('e.g. hollama-session-1');
		await expect(input).toBeVisible();
		await expect(input).toHaveValue('hollama-session-1');
	});

	test('hidden when connectionType is openai (not -compatible)', async ({ page }) => {
		await page.addInitScript((server) => {
			localStorage.setItem('hollama-servers', JSON.stringify([server]));
		}, seed('openai', undefined));

		await page.goto('/settings');
		const input = page.getByPlaceholder('e.g. hollama-session-1');
		await expect(input).toHaveCount(0);
	});

	test('hidden when connectionType is ollama', async ({ page }) => {
		await page.addInitScript((server) => {
			localStorage.setItem('hollama-servers', JSON.stringify([server]));
		}, seed('ollama', undefined));

		await page.goto('/settings');
		const input = page.getByPlaceholder('e.g. hollama-session-1');
		await expect(input).toHaveCount(0);
	});
});

test.describe('sessionAffinityKey - auto-clear $effect', () => {
	/** The $effect at Connection.svelte:51-54 runs whenever
	 *  `server.connectionType` is not `openai-compatible`. On initial
	 *  render with a non-compatible type, the effect MUST clear
	 *  `sessionAffinityKey` even if the persisted server briefly had one
	 *  (e.g. via older versions, manual edit, or a regression in the
	 *  import sanitization step). */

	test('OpenAI server with stale sessionAffinityKey is auto-cleared on load', async ({
		page
	}) => {
		// Seed the bad state: OpenAI server with a sessionAffinityKey that
		// should never have been persisted for that type.
		await page.addInitScript((server) => {
			localStorage.setItem('hollama-servers', JSON.stringify([server]));
		}, seed('openai', 'should-be-cleared'));

		await page.goto('/settings');

		// Wait for the $effect to fire and re-persist the corrected state.
		// We poll localStorage until the bad value is gone (handles async
		// Svelte reactivity scheduling).
		await expect
			.poll(
				async () => {
					return await page.evaluate(() => {
						const raw = localStorage.getItem('hollama-servers');
						const parsed = JSON.parse(raw ?? '[]') as Array<{
							sessionAffinityKey?: string;
						}>;
						// The key is either deleted, undefined, or an empty
						// string — all clear signals.
						const value = parsed[0]?.sessionAffinityKey;
						return value === undefined || value === '' ? 'cleared' : 'still-set';
					});
				},
				{ timeout: 5000 }
			)
			.toBe('cleared');
	});

	test('Ollama server with stale sessionAffinityKey is auto-cleared on load', async ({
		page
	}) => {
		await page.addInitScript((server) => {
			localStorage.setItem('hollama-servers', JSON.stringify([server]));
		}, seed('ollama', 'still-stale'));

		await page.goto('/settings');

		await expect
			.poll(
				async () => {
					return await page.evaluate(() => {
						const raw = localStorage.getItem('hollama-servers');
						const parsed = JSON.parse(raw ?? '[]') as Array<{
							sessionAffinityKey?: string;
						}>;
						const value = parsed[0]?.sessionAffinityKey;
						return value === undefined || value === '' ? 'cleared' : 'still-set';
					});
				},
				{ timeout: 5000 }
			)
			.toBe('cleared');
	});

	test('OpenAI-Compatible server preserves sessionAffinityKey (effect is a no-op)', async ({
		page
	}) => {
		await page.addInitScript((server) => {
			localStorage.setItem('hollama-servers', JSON.stringify([server]));
		}, seed('openai-compatible', 'preserve-me'));

		await page.goto('/settings');

		// Wait briefly, then verify the value is still present.
		await expect(page.getByPlaceholder('e.g. hollama-session-1')).toHaveValue(
			'preserve-me'
		);

		const persisted = await page.evaluate(() => {
			const raw = localStorage.getItem('hollama-servers');
			const parsed = JSON.parse(raw ?? '[]') as Array<{ sessionAffinityKey?: string }>;
			return parsed[0]?.sessionAffinityKey;
		});
		expect(persisted).toBe('preserve-me');
	});
});
