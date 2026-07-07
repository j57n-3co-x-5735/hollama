import { expect, test } from '@playwright/test';

// In web mode (PUBLIC_ADAPTER unset — the default config), the source-directory
// config route is a hard 403 on BOTH verbs: a browser must never be able to
// repoint the server's file roots (e.g. to `/` or `/etc`) and then read host
// files through /api/files/content. Desktop behavior is covered in tests-desktop.
const BASE = 'http://localhost:4173';

test('web mode: /api/files/config GET and POST are 403', async ({ request }) => {
	const get = await request.get(`${BASE}/api/files/config`);
	expect(get.status()).toBe(403);

	const post = await request.post(`${BASE}/api/files/config`, { data: { dirs: ['/tmp'] } });
	expect(post.status()).toBe(403);
});
