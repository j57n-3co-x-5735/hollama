import { expect, test } from '@playwright/test';

// REAL end-to-end test: drives Hollama's UI against a REAL Ollama server
// (no request mocking). Proves Hollama -> Ollama -> model -> reply-in-UI.
// Reply detection uses locator assertions only (CSP forbids unsafe-eval, so
// no page.waitForFunction / injected polling).

const MODEL = 'qwen3-35b-a3b:latest';
const BASE_URL = 'http://localhost:11434';

test('Hollama sends a message to the real Ollama model and shows the reply', async ({ page }) => {
	test.setTimeout(600_000); // CPU-only generation can be slow

	// --- 1. Add an Ollama server connection in Settings ---
	await page.goto('/settings');
	await expect(page.getByText('Servers').first()).toBeVisible();

	// Choose connection type: Ollama (custom combobox)
	await page.getByLabel('Connection type', { exact: true }).click();
	await page.getByText('Ollama', { exact: true }).click();
	await expect(page.getByLabel('Connection type')).toHaveValue('Ollama');

	await page.getByText('Add connection').click();

	const connection = page.getByTestId('server').first();
	await expect(connection).toBeVisible();
	await expect(connection.locator('.badge', { hasText: 'Ollama' })).toBeVisible();

	// Force the base URL explicitly so the test is robust regardless of defaults
	const baseUrlField = connection.getByLabel('Base URL');
	await baseUrlField.fill(BASE_URL);
	await expect(baseUrlField).toHaveValue(BASE_URL);

	// --- 2. Verify the connection against the REAL server (/api/tags) ---
	await connection.getByRole('button', { name: 'Verify', exact: true }).click();
	await expect(page.getByText('Connection has been verified and is ready to use')).toBeVisible({
		timeout: 30_000
	});

	const useModels = page.getByLabel('Use models from this server');
	if (!(await useModels.isChecked())) await useModels.check();
	await expect(useModels).toBeChecked();

	// --- 3. Start a new session and select the model ---
	await page.getByRole('tab', { name: 'Sessions' }).click();
	await page.getByTestId('new-session').click();

	const modelCombobox = page.getByLabel('Available models', { exact: true });
	await expect(modelCombobox).toBeEnabled();
	await modelCombobox.click();
	await page.getByRole('option').filter({ hasText: MODEL }).first().click();

	// --- 4. Type a prompt and submit ---
	const promptTextarea = page.locator('.prompt-editor__textarea');
	// /no_think keeps the Qwen3 reasoning model fast on CPU; ask for a clear word.
	await promptTextarea.fill('/no_think Reply with a short one-sentence greeting that contains the word hello.');
	const runButton = page.getByText('Run');
	await expect(runButton).toBeEnabled();
	await runButton.click();

	// The user's message renders
	await expect(page.locator('article', { hasText: 'You' })).toBeVisible();

	// --- 5. Assert the assistant reply becomes visible (locator-only) ---
	const assistant = page.locator('article', { hasText: 'Assistant' });
	await expect(assistant).toBeVisible({ timeout: 60_000 });
	// Wait for real content: at least one 3+ letter word (the '...' placeholder has none)
	await expect(assistant).toContainText(/[A-Za-z]{3,}/, { timeout: 480_000 });
	// It is a greeting we asked to contain "hello"
	await expect(assistant).toContainText('hello', { ignoreCase: true, timeout: 480_000 });

	const replyText = (await assistant.innerText()).trim();
	console.log('=== ASSISTANT REPLY (from Hollama UI) ===');
	console.log(replyText);
	console.log('=========================================');
	expect(replyText.length).toBeGreaterThan(0);
});
