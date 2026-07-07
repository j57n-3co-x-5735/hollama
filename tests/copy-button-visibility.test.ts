import { expect, test } from '@playwright/test';

// Emulate a coarse-pointer / no-hover environment (touchscreen, a virtual or
// remote display, some Electron display setups). In that context the CSS media
// query `@media (hover: hover)` does NOT match — which is exactly where the
// copy button used to disappear entirely (`.copy-button { display: none }` with
// the visibility only restored under `hover: hover`). A desktop-width viewport
// keeps the rest of the layout as the normal desktop one, so this isolates the
// pointer/hover capability from viewport size.
test.use({ isMobile: true, hasTouch: true, viewport: { width: 1280, height: 1024 } });

const SESSION = {
	id: 'copyvis1',
	messages: [
		{ role: 'user', content: 'Ping for copy visibility' },
		{
			role: 'assistant',
			content: 'Pong — here is a reply worth copying.\n\n```js\nconst answer = 42;\n```'
		}
	],
	systemPrompt: { role: 'system', content: '' },
	systemPromptText: '',
	options: {},
	model: { name: 'gemma:7b', serverId: 'srv1' },
	updatedAt: new Date().toISOString()
};

test.describe('Copy button visibility without a hover-capable pointer', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate((s) => {
			window.localStorage.setItem('hollama-sessions', JSON.stringify([s]));
		}, SESSION);
		await page.goto(`/sessions/${SESSION.id}`);
		await expect(page.getByText('Pong — here is a reply worth copying.')).toBeVisible();
	});

	test('per-message copy button is visible (not display:none)', async ({ page }) => {
		// Regression guard for `.copy-button { display:none; @media(hover:hover){display:unset} }`
		// in ButtonCopy.svelte: on a no-hover pointer the per-message copy button
		// vanished. `toBeVisible()` requires `display != none`, so this fails while
		// the media-query gate is present and passes once it is removed.
		const copyButtons = page.locator('.session__history').getByTitle('Copy');
		await expect(copyButtons.first()).toBeVisible();
	});

	test('header copy control is visible (not display:none)', async ({ page }) => {
		// The header copy control must also be reachable on a no-hover pointer.
		await expect(page.getByTestId('session-copy-button')).toBeVisible();
	});

	test('code-block copy button is not opacity-hidden without a hover-capable pointer', async ({
		page
	}) => {
		// The code-snippet copy button is opacity-gated (pre:hover), which never
		// fires on a no-hover pointer. toBeVisible() ignores opacity, so assert
		// the computed opacity directly: 1 on no-hover after the fix, 0 before.
		const codeCopy = page.locator('pre .copy-button').first();
		await expect(codeCopy).toHaveCSS('opacity', '1');
	});
});
