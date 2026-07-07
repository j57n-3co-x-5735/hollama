import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

// A session that includes an injected file <CONTEXT> block, a real question, and
// an assistant reply with reasoning — so the tests can assert the Markdown view
// excludes infrastructure (context + reasoning) but the JSON view keeps it all.
const SESSION = {
	id: 'export1',
	messages: [
		{
			role: 'user',
			content:
				'\n<CONTEXT>\n\t<CONTEXT_NAME>notes.txt</CONTEXT_NAME>\n\t<CONTEXT_CONTENT>secret content</CONTEXT_CONTENT>\n</CONTEXT>\n'
		},
		{ role: 'user', content: 'What is in my notes?' },
		{
			role: 'assistant',
			content: 'It contains a test note.',
			reasoning: 'the user asked about notes'
		}
	],
	systemPrompt: { role: 'system', content: '' },
	systemPromptText: '',
	options: {},
	model: { name: 'gemma:7b', serverId: 's1' },
	updatedAt: new Date().toISOString()
};

test.describe('Session copy/export menu', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(
			(s) => window.localStorage.setItem('hollama-sessions', JSON.stringify([s])),
			SESSION
		);
		await page.goto(`/sessions/${SESSION.id}`);
		await expect(page.getByText('It contains a test note.')).toBeVisible();
		await page.evaluate(() => navigator.clipboard.writeText(''));
	});

	test('copies the conversation as clean Markdown (no JSON, context, or reasoning)', async ({
		page
	}) => {
		await page.getByTestId('session-copy-button').click();
		await page.getByTestId('copy-as-markdown').click();

		const md = await page.evaluate(() => navigator.clipboard.readText());
		expect(md).toContain('## You');
		expect(md).toContain('What is in my notes?');
		expect(md).toContain('## Assistant');
		expect(md).toContain('It contains a test note.');
		// Infrastructure is excluded from the human-readable Markdown.
		expect(md).not.toContain('<CONTEXT>');
		expect(md).not.toContain('secret content');
		expect(md).not.toContain('the user asked about notes'); // reasoning omitted
		expect(md).not.toContain('"role"'); // not JSON
	});

	test('copies the raw messages as JSON', async ({ page }) => {
		await page.getByTestId('session-copy-button').click();
		await page.getByTestId('copy-as-json').click();

		const json = await page.evaluate(() => navigator.clipboard.readText());
		const parsed = JSON.parse(json);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(3); // all messages, incl. the context block
		expect(parsed.some((m: { content: string }) => m.content.includes('What is in my notes?'))).toBe(
			true
		);
	});

	test('downloads the conversation as a .md file', async ({ page }) => {
		await page.getByTestId('session-copy-button').click();
		const downloadPromise = page.waitForEvent('download');
		await page.getByTestId('download-markdown').click();

		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.md$/);
		const path = await download.path();
		const content = readFileSync(path, 'utf-8');
		expect(content).toContain('## You');
		expect(content).toContain('What is in my notes?');
		expect(content).not.toContain('<CONTEXT>');
	});

	test('menu closes on Escape', async ({ page }) => {
		await page.getByTestId('session-copy-button').click();
		await expect(page.getByTestId('copy-as-markdown')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('copy-as-markdown')).not.toBeVisible();
	});
});
