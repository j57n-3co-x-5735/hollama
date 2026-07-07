import { expect, test, type Locator } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	MOCK_SESSION_2_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse,
	setupStreamedCompletionMock
} from './utils';

test.describe('Session management', () => {
	let promptTextarea: Locator;

	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
		promptTextarea = page.locator('.prompt-editor__textarea');
	});

	test('initializes new session correctly', async ({ page }) => {
		const sessionIdLocator = page.getByTestId('session-id');
		const sessionMetadata = page.getByTestId('session-metadata');
		const runButton = page.getByText('Run');
		const newPromptHelp = page.getByText('Write a prompt to start a new session');

		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await expect(sessionIdLocator).not.toBeVisible();
		await expect(sessionMetadata).not.toBeVisible();
		await expect(newPromptHelp).not.toBeVisible();

		await page.getByTestId('new-session').click();
		await expect(sessionIdLocator).toBeVisible();
		await expect(sessionIdLocator).toHaveText(/Session #[a-z0-9]{2,8}/);
		await expect(sessionMetadata).toHaveText('New session');
		await expect(promptTextarea).toHaveText('');
		await expect(runButton).toBeVisible();
		await expect(runButton).toBeDisabled();
		await expect(newPromptHelp).toBeVisible();
	});

	test('generates a random session id', async ({ page }) => {
		await page.goto('/sessions');

		const sessionIds = [];
		const newSessionButton = page.getByTestId('new-session');

		// Check it generates a new session id 3 times in a row
		for (let i = 0; i < 3; i++) {
			const sessionId = await newSessionButton.getAttribute('href');
			expect(sessionId).toMatch(/[a-z0-9]{2,8}/);
			sessionIds.push(sessionId);
			await newSessionButton.click();
		}

		expect(new Set(sessionIds).size).toBe(3);
	});

	test('preserves session state after navigation', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();

		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();

		await page.getByTestId('new-session').click();
		await expect(page.locator('article')).toHaveCount(0);

		await page.goBack();
		await expect(page.locator('article')).toHaveCount(2);
	});

	test('can navigate older sessions from sidebar', async ({ page }) => {
		const sessionTab = page.getByRole('tab', { name: 'Sessions' });

		await page.goto('/');
		await expect(sessionTab).toHaveAttribute('aria-selected', 'true');
		await expect(sessionTab).toHaveClass(/text-active/);
		await expect(page.getByText('No sessions')).toBeVisible();
		await expect(
			page.locator('aside', {
				hasText: 'Who would win in a fight between Emma Watson and Jessica Alba?'
			})
		).not.toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await page
			.getByText(
				'I am unable to provide subjective or speculative information, including fight outcomes between individuals.'
			)
			.isVisible();
		await expect(page.getByText('No sessions')).not.toBeVisible();

		// Check the session title and model name are displayed correctly
		const sessionTitle = 'Who would win in a fight between Emma Watson and Jessica Alba?';
		const sessionItem = page.getByTestId('session-item');
		expect(await sessionItem.textContent()).toContain(sessionTitle.slice(0, 56));
		expect(await sessionItem.textContent()).not.toContain(sessionTitle);
		expect(await sessionItem.textContent()).toContain(MOCK_API_TAGS_RESPONSE.models[0].name);
		expect(await page.getByTestId('session-item').count()).toBe(1);

		// Leave the conversation by visiting the sessions index
		await sessionTab.click();
		await expect(
			page.getByText(
				'I am unable to provide subjective or speculative information, including fight outcomes between individuals.'
			)
		).not.toBeVisible();
		await expect(page.getByText('Who would win in a fight')).toBeVisible();

		// Navigate back to the conversation
		await page.getByTestId('session-item').click();
		await expect(
			page.getByText(
				'I am unable to provide subjective or speculative information, including fight outcomes between individuals.'
			)
		).toBeVisible();

		// Create a new session
		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await promptTextarea.fill('What does the fox say?');
		await page.getByText('Run').click();
		await expect(
			page.getByText(
				'The fox says various things, such as "ring-a-ding-ding," "bada bing-bing" and "higglety-pigglety pop'
			)
		).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(2);

		// Check the sessions are listed in the correct order
		expect(await page.getByTestId('session-item').first().textContent()).toContain(
			'What does the fox say?'
		);
		expect(await page.getByTestId('session-item').first().textContent()).toContain(
			MOCK_API_TAGS_RESPONSE.models[1].name
		);
		expect(await page.getByTestId('session-item').last().textContent()).toContain(
			'Who would win in a fight'
		);
		expect(await page.getByTestId('session-item').last().textContent()).toContain(
			MOCK_API_TAGS_RESPONSE.models[0].name
		);

		// Check the current session is highlighted in the sidebar
		await expect(page.locator('.section-list-item').first()).toHaveClass(
			/ section-list-item--active/
		);
		await expect(page.locator('.section-list-item').last()).not.toHaveClass(
			/ section-list-item--active/
		);

		// Navigate to Settings and back. Assert a settings element that exists in
		// this build: the auto-update checkbox was removed for privacy (see
		// version.test.ts), so it can't stand in for "we reached settings".
		await page.getByText('Settings').click();
		await expect(page.getByText('Current version')).toBeVisible();

		await page.getByRole('tab', { name: 'Sessions' }).click();

		await expect(page.getByRole('link', { name: 'New session' })).toBeVisible();
		await expect(
			page.getByText('Create a new session or choose an existing one from the list')
		).toBeVisible();
		await expect(page.getByTestId('session-item')).toHaveCount(2);

		// Click first session and verify its state
		await page.getByTestId('session-item').first().click();
		await expect(page.getByRole('combobox')).toHaveValue(MOCK_API_TAGS_RESPONSE.models[1].name);
		await expect(page.getByText('The fox says various things')).toBeVisible();
		await expect(
			page.getByText('Create a new session or choose an existing one from the list')
		).not.toBeVisible();
	});

	test('deletes a session from the header and sidebar', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await expect(page.getByText('No sessions')).toBeVisible();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();
		await expect(page.getByText('No sessions')).not.toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(1);
		await expect(page.locator('header').getByTitle('Copy')).toBeVisible();
		await expect(page.getByTitle('Dismiss')).not.toBeVisible();

		// Check the navigation changes when session deletion needs confirmation
		await page.locator('header').getByTitle('Delete session').click();
		await expect(page.locator('header').getByTitle('Copy')).not.toBeVisible();
		await expect(page.getByTitle('Confirm deletion')).toBeVisible();

		await page.getByTitle('Dismiss').click();
		await expect(page.locator('header').getByTitle('Copy')).toBeVisible();
		await expect(page.getByTitle('Confirm deletion')).not.toBeVisible();
		await expect(page.getByTitle('Dismiss')).not.toBeVisible();

		// Delete the session from the header
		await page.locator('header').getByTitle('Delete session').click();
		await page.getByTitle('Confirm deletion').click();
		await expect(page.getByText('No sessions')).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(0);

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();
		await expect(page.getByText('No sessions')).not.toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(1);

		// Delete the session from the sidebar
		await page.locator('.section-list-item').first().hover();
		await page.locator('.section-list-item').getByTitle('Delete session').click();
		await page.getByTitle('Confirm deletion').click();
		await expect(page.getByText('No sessions')).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(0);
	});

	test('does not resurrect a deleted session after navigating away', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		// Create session A
		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		// Create session B so the sidebar isn't trivially empty after deleting A
		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await promptTextarea.fill('What does the fox say?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();

		expect(await page.getByTestId('session-item').count()).toBe(2);

		// Navigate to session A (the older one, last in the sidebar) and delete it from the sidebar
		// while it's the currently-viewed session — this is the exact path that triggers
		// beforeNavigate's stale-session-reference resurrection bug.
		await page.getByTestId('session-item').last().click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		await page.locator('.section-list-item').last().hover();
		await page.locator('.section-list-item').last().getByTitle('Delete session').click();
		await page.getByTitle('Confirm deletion').click();

		// Deleting navigates to /sessions, which fires beforeNavigate on the just-deleted
		// session's page — without the guard, saveSession() would resurrect it here.
		await expect(page).toHaveURL('/sessions');
		expect(await page.getByTestId('session-item').count()).toBe(1);
		await expect(page.getByText('What does the fox say?')).toBeVisible();
		await expect(page.getByText('Who would win in a fight')).not.toBeVisible();

		// Reload to confirm the deletion persisted and nothing wrote the session back
		await page.reload();
		expect(await page.getByTestId('session-item').count()).toBe(1);
		await expect(page.getByText('What does the fox say?')).toBeVisible();
		await expect(page.getByText('Who would win in a fight')).not.toBeVisible();
	});

	test('does not resurrect a deleted session when its completion finishes mid-stream', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		// Session A — an existing, saved session with one completed exchange.
		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Who would win in a fight between Emma Watson and Jessica Alba?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		// Session B — so the sidebar isn't trivially empty after deleting A.
		await mockCompletionResponse(page, MOCK_SESSION_2_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[1].name);
		await promptTextarea.fill('What does the fox say?');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_2_RESPONSE_1.message.content)).toBeVisible();
		expect(await page.getByTestId('session-item').count()).toBe(2);

		// Return to A (older → last in the sidebar) and start a SECOND completion
		// that we hold open mid-stream via the manual streaming mock.
		await page.getByTestId('session-item').last().click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		const stream = await setupStreamedCompletionMock(page, { manual: true });
		if (!stream)
			throw new Error('setupStreamedCompletionMock did not return a stream object in manual mode');

		await promptTextarea.fill('Actually, tell me more');
		await page.getByText('Run').click();
		// Emit a partial chunk but do NOT finish — the completion is now in flight.
		// (A locator assertion, not page.waitForFunction — the app's strict CSP
		// forbids unsafe-eval, which waitForFunction relies on.)
		stream.sendChunk('Streaming a partial response', false);
		await expect(page.locator('.article--assistant').last()).toContainText(
			'Streaming a partial response'
		);

		// Delete A from the sidebar while its completion is still streaming. This
		// is the exact path the resurrection guard must cover: deletion removes A
		// from the store, then the in-flight completion resolves and — without the
		// guard in handleCompletion()/stopCompletion() and the beforeNavigate
		// abort — saveSession()'s upsert would re-insert it.
		await page.locator('.section-list-item').last().hover();
		await page.locator('.section-list-item').last().getByTitle('Delete session').click();
		await page.getByTitle('Confirm deletion').click();
		await expect(page).toHaveURL('/sessions');

		// Let the stream resolve after the deletion; give the completion handler a
		// tick to run whatever save path it would take.
		stream.sendChunk(' that just finished.', true);
		await page.waitForTimeout(300);

		// A must not have come back — only B remains.
		expect(await page.getByTestId('session-item').count()).toBe(1);
		await expect(page.getByText('What does the fox say?')).toBeVisible();
		await expect(page.getByText('Who would win in a fight')).not.toBeVisible();

		// And it stays gone across a reload (nothing wrote it back to storage).
		await page.reload();
		expect(await page.getByTestId('session-item').count()).toBe(1);
		await expect(page.getByText('Who would win in a fight')).not.toBeVisible();
	});

	test('truncates session titles correctly', async ({ page }) => {
		const longPrompt =
			'This is a very long prompt that should be truncated in both the page title and the sidebar list item.\nIt contains more than 56 characters to ensure truncation works correctly.';
		const truncatedPrompt = longPrompt.slice(0, 56);

		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);

		// Check initial title
		await expect(page).toHaveTitle('New session • Sessions • Hollama');
		await expect(page.getByTestId('session-item')).not.toBeVisible();

		// Submit prompt and verify truncation
		await promptTextarea.fill(longPrompt);
		await page.getByText('Run').click();

		// Verify page title is truncated
		await expect(page).toHaveTitle(`${truncatedPrompt} • Sessions • Hollama`);

		// Verify sidebar list item is truncated
		await expect(page.getByTestId('session-item')).toBeVisible();
		await expect(page.getByTestId('session-item')).toContainText(truncatedPrompt);
		await expect(page.getByTestId('session-item')).not.toContainText(longPrompt);
	});

	test('can edit session titles', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Sessions' }).click();

		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
		await promptTextarea.fill('Original title');
		await page.getByText('Run').click();

		// Verify initial title
		const sessionListItem = page.locator('.section-list-item');
		const sessionActions = page.locator('.section-list-item__actions');
		await expect(sessionListItem).toContainText('Original title');
		await expect(sessionActions).toHaveCSS('opacity', '0');
		await expect(sessionListItem.getByText('Edit title')).not.toBeVisible();

		// Enter edit mode
		await sessionListItem.hover();
		await expect(sessionActions).toHaveCSS('opacity', '1');
		await expect(sessionListItem.getByText('Confirm edit')).not.toBeVisible();
		await expect(sessionListItem.getByText('Dismiss')).not.toBeVisible();

		// Verify edit mode UI
		await sessionListItem.getByTitle('Edit title').click();
		await expect(sessionListItem.getByTitle('Confirm edit')).toBeVisible();
		await expect(sessionListItem.getByTitle('Dismiss')).toBeVisible();
		await expect(sessionListItem.getByTitle('Delete session')).not.toBeVisible();

		// Edit the title
		const titleInput = page.locator('.section-list-item__title-input');
		await expect(titleInput).toBeFocused();

		// Verify the title was updated
		await titleInput.fill('New title');
		await sessionListItem.getByTitle('Confirm edit').click();
		await expect(sessionListItem).toContainText('New title');
		await expect(sessionListItem.getByText('Confirm edit')).not.toBeVisible();
		await expect(sessionListItem.getByText('Dismiss')).not.toBeVisible();

		// Verify the title persists after page reload
		await page.reload();
		await expect(sessionListItem).toContainText('New title');

		// Test canceling edit
		await sessionListItem.hover();
		await sessionListItem.getByTitle('Edit title').click();
		await titleInput.fill('Canceled title');
		await sessionListItem.getByTitle('Dismiss').click();
		await expect(sessionListItem).not.toContainText('Canceled title');
		await expect(sessionListItem).toContainText('New title');
	});
});
