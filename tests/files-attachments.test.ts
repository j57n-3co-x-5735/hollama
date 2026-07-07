import { expect, test, type Page, type Route } from '@playwright/test';

import {
	chooseModel,
	MOCK_API_TAGS_RESPONSE,
	MOCK_SESSION_1_RESPONSE_1,
	mockCompletionResponse,
	mockOllamaModelsResponse
} from './utils';

const ROOT_DIR = '/home/user/docs';

async function mockFilesApi(page: Page) {
	// A single handler branching on pathname, rather than two glob patterns —
	// a bare '**/api/files' glob doesn't match the '?dir=...' query-string
	// variant, and a '**/api/files**' glob (broad enough to catch it) also
	// swallows '/api/files/content', so pathname-branching in JS is the
	// robust option instead of fighting glob semantics.
	await page.route('**/api/files/**', async (route: Route) => {
		await handleFilesApiRoute(route);
	});
	await page.route('**/api/files?*', async (route: Route) => {
		await handleFilesApiRoute(route);
	});
	await page.route('**/api/files', async (route: Route) => {
		await handleFilesApiRoute(route);
	});
}

async function handleFilesApiRoute(route: Route) {
	const url = new URL(route.request().url());
	// The client now navigates by root index + relative path; the legacy
	// absolute-path params are still accepted by the routes and by this mock.
	const root = url.searchParams.get('root');
	const rel = url.searchParams.get('rel') ?? '';

	if (url.pathname === '/api/files/content') {
		const path = url.searchParams.get('path');
		const isReport = (root === '0' && rel === 'report.txt') || path === `${ROOT_DIR}/report.txt`;
		if (isReport) {
			await route.fulfill({
				status: 200,
				contentType: 'text/plain; charset=utf-8',
				body: 'Quarterly report contents.'
			});
			return;
		}
		await route.fulfill({
			status: 404,
			contentType: 'application/json',
			body: '{"error":"Path not accessible"}'
		});
		return;
	}

	// Roots bootstrap: no root/dir params → basename + index (never absolute paths).
	if (root === null && !url.searchParams.get('dir')) {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ roots: [{ name: 'docs', index: 0 }] })
		});
		return;
	}
	// Listing the (single) root.
	if ((root === '0' && rel === '') || url.searchParams.get('dir') === ROOT_DIR) {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				entries: [
					{ name: 'report.txt', type: 'file', size: 1234, modified: new Date().toISOString() },
					{ name: 'notes', type: 'dir' }
				],
				truncated: false
			})
		});
		return;
	}
	await route.fulfill({
		status: 404,
		contentType: 'application/json',
		body: '{"error":"Path not accessible"}'
	});
}

test.describe('File attachments', () => {
	test.beforeEach(async ({ page }) => {
		await mockOllamaModelsResponse(page);
		await mockFilesApi(page);
	});

	async function startSession(page: Page) {
		await page.getByRole('tab', { name: 'Sessions' }).click();
		await page.getByTestId('new-session').click();
		await chooseModel(page, MOCK_API_TAGS_RESPONSE.models[0].name);
	}

	test('browses directories and selects a file as one-off', async ({ page }) => {
		await page.goto('/');
		await startSession(page);

		await page.getByTestId('browse-files').click();
		await expect(page.getByTestId('file-browser')).toBeVisible();
		await expect(page.getByTestId('file-browser-entry')).toHaveCount(2);

		await page.getByTestId('file-browser-attach-once').click();
		await expect(page.getByTestId('file-attachment-badge')).toHaveText('report.txt');
	});

	test('selects a file as persistent, shown with a pin indicator', async ({ page }) => {
		await page.goto('/');
		await startSession(page);

		await page.getByTestId('browse-files').click();
		await page.getByTestId('file-browser-attach-persistent').click();

		const badge = page.getByTestId('file-attachment-badge');
		await expect(badge).toContainText('report.txt');
		await expect(badge).toHaveClass(/file-badge--persistent/);
	});

	test('attaches file content at send time and persistent files survive the send', async ({
		page
	}) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await startSession(page);

		await page.getByTestId('browse-files').click();
		await page.getByTestId('file-browser-attach-persistent').click();
		await page.getByRole('dialog', { name: 'Browse files' }).getByRole('button', { name: 'Dismiss' }).click();
		await expect(page.getByTestId('file-browser')).not.toBeVisible();

		let requestPayload: { messages: { content: string }[] } | undefined;
		await page.route('**/api/chat', async (route: Route) => {
			requestPayload = route.request().postDataJSON();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(MOCK_SESSION_1_RESPONSE_1)
			});
		});

		await prompt.fill('Summarize this');
		await page.getByText('Run').click();
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();

		expect(requestPayload?.messages.some((m) => m.content.includes('Quarterly report contents.'))).toBe(
			true
		);
		// Persistent file badge remains after send
		await expect(page.getByTestId('file-attachment-badge')).toBeVisible();
	});

	test('removes a file attachment', async ({ page }) => {
		await page.goto('/');
		await startSession(page);

		await page.getByTestId('browse-files').click();
		await page.getByTestId('file-browser-attach-once').click();
		await page.getByRole('dialog', { name: 'Browse files' }).getByRole('button', { name: 'Dismiss' }).click();
		await expect(page.getByTestId('file-browser')).not.toBeVisible();
		await expect(page.getByTestId('file-attachment-badge')).toBeVisible();

		await page.getByTestId('file-attachment-remove').click();
		await expect(page.getByTestId('file-attachments')).not.toBeVisible();
	});

	test('a file whose content fails to fetch at send time toasts and auto-removes the reference', async ({
		page
	}) => {
		const prompt = page.locator('.prompt-editor__textarea');
		await page.goto('/');
		await startSession(page);

		// Attach report.txt PERSISTENTLY — normally a persistent file survives the
		// send, so if it still disappears we know the broken-reference cleanup ran.
		await page.getByTestId('browse-files').click();
		await page.getByTestId('file-browser-attach-persistent').click();
		await page
			.getByRole('dialog', { name: 'Browse files' })
			.getByRole('button', { name: 'Dismiss' })
			.click();
		await expect(page.getByTestId('file-attachment-badge')).toBeVisible();

		// Simulate the file becoming unreadable between selection and send (moved,
		// deleted, permissions changed): its content fetch now 404s. Registered
		// last, so this override wins over the beforeEach mock.
		await page.route('**/api/files/content**', async (route: Route) => {
			await route.fulfill({
				status: 404,
				contentType: 'application/json',
				body: '{"error":"Path not accessible"}'
			});
		});
		await mockCompletionResponse(page, MOCK_SESSION_1_RESPONSE_1);

		await prompt.fill('Summarize this');
		await page.getByText('Run').click();

		// The failure is surfaced to the user (non-blocking)...
		await expect(page.getByText('Could not attach report.txt')).toBeVisible();
		// ...the broken reference is dropped even though it was persistent, so it
		// can't silently fail on every future send...
		await expect(page.getByTestId('file-attachment-badge')).not.toBeVisible();
		// ...and the user's own message still went through despite the file error.
		await expect(page.getByText(MOCK_SESSION_1_RESPONSE_1.message.content)).toBeVisible();
	});
});
