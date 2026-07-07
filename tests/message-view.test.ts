import { expect, test } from '@playwright/test';

// A session whose ONLY message is a knowledge attachment: on load it has
// messages, so `editor.isNewSession` is false. Deleting that attachment empties
// `session.messages` IN PLACE while isNewSession stays false — the state that
// used to render a blank void (the empty-state keyed only on isNewSession).
const SESSION = {
	id: 'blankfix1',
	messages: [
		{
			role: 'user',
			knowledge: { id: 'k1', name: 'AttachedDoc', content: 'doc body' },
			content: 'ctx'
		}
	],
	systemPrompt: { role: 'system', content: '' },
	systemPromptText: '',
	options: {},
	model: { name: 'gemma:7b', serverId: 's1' },
	updatedAt: new Date().toISOString()
};

test.describe('Message view', () => {
	test('a session whose messages are all removed shows the empty state, not a blank window', async ({
		page
	}) => {
		await page.goto('/');
		await page.evaluate(
			(s) => window.localStorage.setItem('hollama-sessions', JSON.stringify([s])),
			SESSION
		);
		await page.goto(`/sessions/${SESSION.id}`);

		const attachment = page.locator('.attachment');
		await expect(attachment).toBeVisible();
		await expect(page.getByText('AttachedDoc')).toBeVisible();

		// Delete the only message (the attachment's trash button).
		await attachment.hover();
		await attachment.getByRole('button').click();

		// The message area must render the empty-state, NOT a blank void.
		await expect(page.locator('.attachment')).toHaveCount(0);
		await expect(page.getByText('Write a prompt to start a new session')).toBeVisible();
	});
});
