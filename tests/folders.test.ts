import { expect, test, type Page } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	MOCK_SESSION_2_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

// Playwright's locator.dragTo() drives real mouse events, which is not
// reliable for pure HTML5 native drag-and-drop (as opposed to
// pointer-based sortable libraries) — dispatching the DragEvent sequence
// directly against a real in-page DataTransfer is the documented, reliable
// alternative for this kind of implementation.
async function simulateHtml5Drag(page: Page, sourceTestId: string, targetTestId: string) {
	await page.evaluate(
		([srcId, tgtId]) => {
			const source = document.querySelector(`[data-testid="${srcId}"]`);
			const target = document.querySelector(`[data-testid="${tgtId}"]`);
			if (!source || !target) throw new Error('drag source or target not found');

			const dataTransfer = new DataTransfer();
			source.dispatchEvent(
				new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer })
			);
			target.dispatchEvent(
				new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
			);
			target.dispatchEvent(
				new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
			);
			source.dispatchEvent(
				new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer })
			);
		},
		[sourceTestId, targetTestId]
	);
}

test.describe('Folders', () => {
	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
	});

	test('creates, renames, and deletes a folder; deleting moves sessions to unfiled', async ({
		page
	}) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await prompt.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		// Create a folder
		await page.getByTestId('new-folder').click();
		await expect(page.getByTestId('folder-item')).toBeVisible();
		await expect(page.getByTestId('folder-item')).toContainText('New folder');

		// Rename it
		await page.getByTestId('folder-item').hover();
		await page.getByTestId('folder-item').getByTitle('Edit title').click();
		const renameInput = page.locator('.sidebar-folder__title-input');
		await renameInput.fill('Research');
		await renameInput.press('Enter');
		await expect(page.getByTestId('folder-item')).toContainText('Research');

		// Drag the session into the folder. New folders start expanded, so
		// its contents are already visible without toggling.
		await simulateHtml5Drag(page, 'session-item-draggable', 'folder-item');
		await expect(page.getByTestId('folder-item').getByTestId('session-item')).toBeVisible();
		await expect(page.getByTestId('unfiled-drop-zone').getByTestId('session-item')).toHaveCount(0);

		// Reload — folder, its expanded state, and its session assignment persist
		await page.reload();
		await expect(page.getByTestId('folder-item')).toContainText('Research');
		await expect(page.getByTestId('folder-item').getByTestId('session-item')).toBeVisible();

		// Delete the folder — the session moves to unfiled, not deleted
		await page.getByTestId('folder-item').hover();
		await page.getByTestId('folder-delete').click();
		await page.getByTestId('folder-delete-confirm').click();
		await expect(page.getByTestId('folder-item')).not.toBeVisible();
		await expect(page.getByTestId('unfiled-drop-zone').getByTestId('session-item')).toHaveCount(1);
	});

	test('a session whose folderId matches no folder renders as unfiled, not a phantom folder', async ({
		page
	}) => {
		// This is the concrete failure the import path can produce: a session
		// exported from one instance carries a folderId whose folder does not
		// exist in this instance's folders store (getFoldersWithSessions must
		// treat it as unfiled rather than crash or synthesize an empty group).
		// It is the substantive protection for importing folders and sessions in
		// either order — verified directly here regardless of import order, since
		// the data-management page imports each store independently.
		const orphanSession = {
			id: 'orphan-0001',
			messages: [
				{ role: 'user', content: 'A session pointing at a folder that does not exist here' },
				{ role: 'assistant', content: 'Rendered under unfiled.' }
			],
			systemPrompt: { role: 'system', content: '' },
			systemPromptText: '',
			options: {},
			model: { name: 'gemma:7b', serverId: 'ghost-server' },
			updatedAt: new Date().toISOString(),
			folderId: 'folder-that-does-not-exist'
		};

		await page.goto('/');

		const consoleErrors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') consoleErrors.push(msg.text());
		});

		await page.evaluate((session) => {
			window.localStorage.setItem('hollama-sessions', JSON.stringify([session]));
			window.localStorage.setItem('hollama-folders', JSON.stringify([]));
		}, orphanSession);
		await page.reload();
		await page.getByRole('tab', { name: 'Sessions' }).click();

		// The session renders, in the unfiled zone, with no phantom folder group.
		await expect(page.getByTestId('unfiled-drop-zone').getByTestId('session-item')).toHaveCount(1);
		await expect(page.getByTestId('folder-item')).toHaveCount(0);
		expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
	});

	test('folder expand/collapse state persists across reload', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-folder').click();

		// New folders start expanded
		await expect(page.getByTestId('folder-toggle')).toHaveAttribute('aria-expanded', 'true');

		await page.getByTestId('folder-toggle').click();
		await expect(page.getByTestId('folder-toggle')).toHaveAttribute('aria-expanded', 'false');

		await page.reload();
		await expect(page.getByTestId('folder-toggle')).toHaveAttribute('aria-expanded', 'false');
	});

	test('keyboard-accessible move-to-folder menu as a drag-and-drop alternative', async ({
		page
	}) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await prompt.fill('What does the fox say?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();

		await page.getByTestId('new-folder').click();
		await expect(page.getByTestId('folder-item')).toContainText('New folder');

		// Reach the move-to-folder trigger by KEYBOARD, not mouse hover — this
		// is the drag-and-drop alternative keyboard-only users depend on. The
		// prior bug rendered the action bar with `visibility:hidden` at rest,
		// which drops the trigger out of the tab order: .focus() would be a
		// no-op and toBeFocused() would fail. Opacity-only keeps it focusable.
		// exact:true is required since the menu also lists a "New folder..."
		// creation action that would otherwise match the same substring.
		const moveTrigger = page.getByTestId('session-move-trigger');
		await moveTrigger.focus();
		await expect(moveTrigger).toBeFocused();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();

		// New folders start expanded, so its contents are already visible.
		await expect(page.getByTestId('folder-item').getByTestId('session-item')).toBeVisible();

		// Remove from folder via the same keyboard-reachable menu.
		const movedTrigger = page.getByTestId('folder-item').getByTestId('session-move-trigger');
		await movedTrigger.focus();
		await expect(movedTrigger).toBeFocused();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitem', { name: 'Remove from folder' }).click();
		await expect(page.getByTestId('unfiled-drop-zone').getByTestId('session-item')).toHaveCount(1);
	});

	test('clicking the folder name toggles expand/collapse; rename is only via the pencil', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-folder').click();
		await expect(page.getByTestId('folder-item')).toContainText('New folder');

		// New folders start expanded.
		await expect(page.getByTestId('folder-toggle')).toHaveAttribute('aria-expanded', 'true');

		// Clicking the NAME toggles collapse/expand — it must NOT enter rename mode.
		await page.getByTestId('folder-name-toggle').click();
		await expect(page.getByTestId('folder-toggle')).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.sidebar-folder__title-input')).toHaveCount(0);

		// Clicking the name again expands it back.
		await page.getByTestId('folder-name-toggle').click();
		await expect(page.getByTestId('folder-toggle')).toHaveAttribute('aria-expanded', 'true');

		// Rename is reachable only via the pencil (hover-revealed), not the title.
		await page.getByTestId('folder-item').hover();
		await page.getByTestId('folder-item').getByTitle('Edit title').click();
		const input = page.locator('.sidebar-folder__title-input');
		await expect(input).toBeFocused();
		await input.fill('Renamed via the pencil');
		await input.press('Enter');
		await expect(page.getByTestId('folder-item')).toContainText('Renamed via the pencil');
	});

	test('the pencil (rename affordance) appears on click, not only on hover', async ({ page }) => {
		// The pencil (rename affordance) appears on hover OR click. Hover is covered by the
		// rename test above; this pins the CLICK path — clicking the folder focuses it
		// and the action nav is revealed via the intentional :focus-within rule (the
		// same pattern the codebase uses for keyboard reachability), not incidentally.
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-folder').click();
		await expect(page.getByTestId('folder-item')).toBeVisible();

		const actions = page.getByTestId('folder-item').locator('.sidebar-folder__actions');

		// Resting state: mouse away, nothing inside the folder focused → hidden.
		await page.mouse.move(0, 0);
		await expect(actions).toHaveCSS('opacity', '0');

		// Clicking the folder name focuses it → :focus-within reveals the pencil.
		await page.getByTestId('folder-name-toggle').click();
		await expect(actions).toHaveCSS('opacity', '1');
		await expect(page.getByTestId('folder-item').getByTitle('Edit title')).toBeVisible();
	});

	test('window blur during a drag clears the stuck drag-over highlight', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-folder').click();
		await expect(page.getByTestId('folder-item')).toBeVisible();

		// Simulate a drag hovering over the folder → the drag-over highlight appears.
		await page.evaluate(() => {
			const folder = document.querySelector('[data-testid="folder-item"]');
			folder?.dispatchEvent(
				new DragEvent('dragover', {
					bubbles: true,
					cancelable: true,
					dataTransfer: new DataTransfer()
				})
			);
		});
		await expect(page.getByTestId('folder-item')).toHaveClass(/sidebar-folder--drag-over/);

		// Alt+Tab / focus loss mid-drag: the window-blur handler must clear it so
		// no drag-over highlight gets stuck.
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await expect(page.getByTestId('folder-item')).not.toHaveClass(/sidebar-folder--drag-over/);
	});
});
