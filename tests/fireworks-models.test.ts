import { expect, test } from '@playwright/test';

import { fetchFireworksModels } from '$lib/server/fireworks-models';

/**
 * Fireworks proprietary model-listing tests.
 *
 * The `fetchFireworksModels` helper is the fallback that the proxy endpoint
 * uses when the standard `/v1/models` route fails for a Fireworks URL.
 * The function is tested directly with an injected `fetchFn` so we can
 * precisely control upstream responses without making real network calls.
 *
 * Coverage targets:
 *  - Model name mapping: `m.name` becomes `id`, `object` is fixed to 'model'
 *  - Custom headers forwarding: extraHeaders (e.g. Authorization) reach upstream
 *  - Network error: fetch throws → 502 with error message
 *  - Empty response (no models): 200 with empty data array
 *  - Non-standard shape: response without `models` array → 502 with shape error
 *  - Happy single-page + pagination + multi-page combined
 */

type FetchFn = typeof fetch;

/** Helper to build a Response object from a body. The body parameter is
 *  the object to JSON-encode into the response (mimics an upstream
 *  returning JSON). For non-JSON tests, the caller can return a custom
 *  Response. */
function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

test.describe('fetchFireworksModels - happy paths', () => {
	test('single-page response: maps model name → id, object: model', async () => {
		const upstream = jsonResponse({
			models: [
				{ name: 'accounts/fireworks/models/llama-v3p1-8b-instruct', created: '2025-01-01' },
				{ name: 'accounts/fireworks/models/llama-v3p1-70b-instruct' }
			]
		});

		const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];
		const fetchFn: FetchFn = async (input, init) => {
			fetchCalls.push({
				url: typeof input === 'string' ? input : input.toString(),
				headers: (init?.headers as Record<string, string>) ?? {}
			});
			return upstream;
		};

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{ Authorization: 'Bearer sk-test' },
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.data?.data).toHaveLength(2);
		expect(result.data?.data[0]).toEqual({
			id: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
			object: 'model'
		});
		expect(result.data?.data[1]).toEqual({
			id: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
			object: 'model'
		});
		expect(result.error).toBeUndefined();

		// Hit count + URL correctness.
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(
			'https://api.fireworks.ai/v1/accounts/fireworks/models?pageSize=200'
		);
	});

	test('custom headers forwarding: Authorization reaches upstream', async () => {
		const upstream = jsonResponse({ models: [{ name: 'm1' }] });

		const fetchCalls: Array<{ headers: Record<string, string> }> = [];
		const fetchFn: FetchFn = async (_input, init) => {
			fetchCalls.push({ headers: (init?.headers as Record<string, string>) ?? {} });
			return upstream;
		};

		await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{
				Authorization: 'Bearer sk-fireworks-1234',
				'X-Custom-Forwarding': 'extra-value'
			},
			new AbortController().signal,
			fetchFn
		);

		expect(fetchCalls[0].headers['Authorization']).toBe('Bearer sk-fireworks-1234');
		expect(fetchCalls[0].headers['X-Custom-Forwarding']).toBe('extra-value');
	});
});

test.describe('fetchFireworksModels - pagination', () => {
	test('paginates through pages until nextPageToken is empty/missing', async () => {
		const page1 = jsonResponse({
			models: [{ name: 'm1' }, { name: 'm2' }],
			nextPageToken: 'page-2-token'
		});
		const page2 = jsonResponse({
			models: [{ name: 'm3' }, { name: 'm4' }]
			// No nextPageToken → last page.
		});

		const fetchCalls: Array<{ url: string }> = [];
		let callIndex = 0;
		const fetchFn: FetchFn = async (input) => {
			fetchCalls.push({ url: typeof input === 'string' ? input : input.toString() });
			const response = callIndex === 0 ? page1 : page2;
			callIndex++;
			return response;
		};

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.data?.data.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(fetchCalls).toHaveLength(2);
		expect(fetchCalls[0].url).toContain('pageSize=200');
		expect(fetchCalls[0].url).not.toContain('pageToken=');
		expect(fetchCalls[1].url).toContain('pageToken=page-2-token');
	});

	test('multi-page: 3 pages combined correctly', async () => {
		const page1Body = { models: [{ name: 'a' }], nextPageToken: 't2' };
		const page2Body = { models: [{ name: 'b' }], nextPageToken: 't3' };
		const page3Body = { models: [{ name: 'c' }] };
		const pages = [page1Body, page2Body, page3Body];

		let i = 0;
		const fetchFn: FetchFn = async () => jsonResponse(pages[i++] ?? {});

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.data?.data.map((m) => m.id)).toEqual(['a', 'b', 'c']);
	});

	test('caps at 10 pages (defense against runaway pagination)', async () => {
		// Simulate a server that always returns nextPageToken — without the
		// cap, this would loop forever.
		const fetchFn: FetchFn = async () =>
			jsonResponse({ models: [{ name: 'one' }], nextPageToken: 'keep-going' });

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		// Status 200 from the LAST page (cap is silent on success).
		expect(result.status).toBe(200);
		expect(result.data?.data).toHaveLength(10);
	});
});

test.describe('fetchFireworksModels - error paths', () => {
	test('network error: fetch throws → 502 with error message', async () => {
		const fetchFn: FetchFn = async () => {
			throw new Error('ECONNREFUSED — upstream unreachable');
		};

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(502);
		expect(result.error).toContain('Fireworks model listing failed');
		expect(result.error).toContain('ECONNREFUSED');
		expect(result.data).toBeUndefined();
	});

	test('non-Error thrown: error message defaults to "Network error"', async () => {
		const fetchFn: FetchFn = async () => {
			throw 'plain string thrown';
		};

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(502);
		expect(result.error).toContain('Network error');
	});

	test('upstream 4xx: returns status with upstream error text', async () => {
		const fetchFn: FetchFn = async () =>
			new Response('{"error":"invalid_token"}', {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(401);
		expect(result.error).toContain('401');
		expect(result.error).toContain('invalid_token');
	});

	test('upstream 500: returns 500 with error text', async () => {
		const fetchFn: FetchFn = async () =>
			new Response('Internal Server Error', { status: 500 });

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(500);
		expect(result.error).toContain('500');
	});

	test('non-JSON upstream response: returns 502 shape error', async () => {
		const fetchFn: FetchFn = async () =>
			new Response('<html><body>nope</body></html>', {
				status: 200,
				headers: { 'Content-Type': 'text/html' }
			});

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(502);
		expect(result.error).toContain('non-JSON');
	});

	test('non-standard shape (no models array): returns 502 shape error', async () => {
		const fetchFn: FetchFn = async () =>
			jsonResponse({
				models: 'not-an-array',
				nextPageToken: 'x'
			});

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(502);
		expect(result.error).toContain('unexpected response shape');
	});

	test('non-standard shape (no models key): returns 502 shape error', async () => {
		const fetchFn: FetchFn = async () => jsonResponse({ data: [] });

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(502);
		expect(result.error).toContain('unexpected response shape');
	});
});

test.describe('fetchFireworksModels - data filtering', () => {
	test('empty models array: returns 200 with empty data', async () => {
		const fetchFn: FetchFn = async () => jsonResponse({ models: [] });

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.data?.data).toEqual([]);
	});

	test('models with missing name field are filtered out', async () => {
		const fetchFn: FetchFn = async () =>
			jsonResponse({
				models: [
					{ name: 'valid-1' },
					{ no_name: true }, // missing name
					{ name: null }, // null name
					{ name: 42 }, // non-string name
					{ name: 'valid-2' }
				]
			});

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.data?.data.map((m) => m.id)).toEqual(['valid-1', 'valid-2']);
	});
});

test.describe('fetchFireworksModels - baseUrl resolution', () => {
	test('uses origin from any Fireworks base URL path', async () => {
		const fetchFn: FetchFn = async (input) => {
			// Verify the function strips the path and uses just origin.
			const url = typeof input === 'string' ? input : input.toString();
			expect(url.startsWith('https://api.fireworks.ai/')).toBe(true);
			return jsonResponse({ models: [{ name: 'm1' }] });
		};

		const result = await fetchFireworksModels(
			'https://api.fireworks.ai/some/legacy/path',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.data?.data).toHaveLength(1);
	});

	test('non-URL baseUrl falls into error path', async () => {
		const fetchFn: FetchFn = async () => jsonResponse({ models: [] });

		const result = await fetchFireworksModels(
			'not-a-url',
			{},
			new AbortController().signal,
			fetchFn
		);

		expect(result.status).toBe(502);
		expect(result.error).toContain('invalid baseUrl');
		// Falls through without calling fetchFn.
	});
});

test.describe('fetchFireworksModels - signal forwarding', () => {
	test('AbortSignal is passed through to fetchFn', async () => {
		const ac = new AbortController();
		const fetchFn: FetchFn = async (_input, init) => {
			expect(init?.signal).toBe(ac.signal);
			return jsonResponse({ models: [] });
		};

		await fetchFireworksModels(
			'https://api.fireworks.ai/inference/v1',
			{},
			ac.signal,
			fetchFn
		);
	});
});
