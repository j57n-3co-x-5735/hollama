import { expect, test } from '@playwright/test';

import { mockOllamaModelsResponse } from './utils';

const currentVersion = process.env.npm_package_version;

test.beforeEach(async ({ page }) => {
	await mockOllamaModelsResponse(page);
});

test('displays current version badge', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByText(currentVersion!)).toBeVisible();
});

test('does not show auto-update checkbox or check button', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByLabel('Automatically check for updates')).not.toBeVisible();
	await expect(page.getByRole('button', { name: 'Check now' })).not.toBeVisible();
});

test('does not make any request to GitHub on navigation', async ({ page }) => {
	const githubRequests: string[] = [];
	page.on('request', (req) => {
		if (req.url().includes('github.com') || req.url().includes('api.github.com')) {
			githubRequests.push(req.url());
		}
	});

	await page.goto('/settings');
	await page.goto('/sessions');
	await page.goto('/knowledge');
	await page.goto('/motd');
	await page.goto('/settings');

	expect(githubRequests).toHaveLength(0);
});

test('does not make any request to Plausible on page load', async ({ page }) => {
	const analyticsRequests: string[] = [];
	page.on('request', (req) => {
		if (req.url().includes('plausible')) {
			analyticsRequests.push(req.url());
		}
	});

	await page.goto('/');
	await page.goto('/sessions');
	await page.goto('/settings');

	expect(analyticsRequests).toHaveLength(0);
});
