import { expect, test } from '@playwright/test';

import { buildUpstreamHeaders, handleModelsRequest } from '$lib/server/models-handler';

/**
 * `/api/models` orchestration tests.
 *
 * The orchestration logic lives in `handleModelsRequest`. It controls
 * the decision tree:
 *   1. Fireworks URLs → go directly to the proprietary
 *      `/v1/accounts/fireworks/models` paginated route (skip standard).
 *   2. Non-Fireworks: standard `/v1/models` succeeds → return upstream
 *      JSON verbatim.
 *   3. Non-Fireworks: standard fetch throws → return 502 "Network error".
 *   4. Non-Fireworks: standard returns 401 → "Invalid API key".
 *   5. Non-Fireworks: standard returns 403 → "Access denied".
 *
 * Tests inject a `fetchFn` so we can precisely observe the call
 * sequence and the decision branches.
 */

type FetchFn = typeof fetch;

const FIREWORKS_BASE = 'https://api.fireworks.ai/inference/v1';
const NON_FIREWORKS_BASE = 'https://api.openai.com/v1';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** Trace-resolving fetchFn: records each call URL, then returns the
 *  next response from the supplied queue. Calls beyond the queue
 *  return a "no more calls" sentinel that makes the test fail with
 *  a clear message. */
function makeTracedFetch(responses: Array<Response | Error>): {
	fetchFn: FetchFn;
	calls: Array<{ url: string; headers: Record<string, string> }>;
} {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	let index = 0;
	const fetchFn: FetchFn = async (input, init) => {
		calls.push({
			url: typeof input === 'string' ? input : input.toString(),
			headers: (init?.headers as Record<string, string>) ?? {}
		});
		const next = responses[index++];
		if (!next) {
			throw new Error(`Unexpected call #${index} to ${input}`);
		}
		if (next instanceof Error) throw next;
		return next;
	};
	return { fetchFn, calls };
}

test.describe('handleModelsRequest - happy paths', () => {
	test('standard /models succeeds → returns upstream JSON verbatim', async () => {
		const upstreamBody = { data: [{ id: 'gpt-4', object: 'model' }] };
		const { fetchFn, calls } = makeTracedFetch([jsonResponse(upstreamBody)]);
		const ac = new AbortController();

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: ac.signal
			},
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.body).toEqual(upstreamBody);
		// One call only — to the standard /models route.
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${NON_FIREWORKS_BASE}/models`);
	});

	test('Authorization header is set on every upstream call', async () => {
		const { fetchFn, calls } = makeTracedFetch([jsonResponse({ data: [] })]);
		const ac = new AbortController();

		await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-fireworks-abc',
				signal: ac.signal
			},
			fetchFn
		);

		// First (and only) call has Authorization set.
		expect(calls[0].headers['Authorization']).toBe('Bearer sk-fireworks-abc');
	});
});

test.describe('handleModelsRequest - Fireworks direct proprietary', () => {
	test('Fireworks URL → calls proprietary endpoint directly (one call)', async () => {
		const { fetchFn, calls } = makeTracedFetch([
			jsonResponse({ models: [{ name: 'm1' }, { name: 'm2' }] })
		]);
		const ac = new AbortController();

		const result = await handleModelsRequest(
			{
				baseUrl: FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: ac.signal
			},
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.body).toEqual({
			data: [
				{ id: 'm1', object: 'model' },
				{ id: 'm2', object: 'model' }
			]
		});

		// ONE call only — directly to proprietary, no standard /models attempt.
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('/v1/accounts/fireworks/models');
	});

	test('Fireworks proprietary returns auth error → surfaces error', async () => {
		const { fetchFn, calls } = makeTracedFetch([jsonResponse({ error: 'Unauthorized' }, 401)]);

		const result = await handleModelsRequest(
			{
				baseUrl: FIREWORKS_BASE,
				apiKey: 'sk-bad',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(401);
		expect((result.body as { error: string }).error).toContain('Fireworks model listing failed');
		expect(calls).toHaveLength(1);
	});

	test('Fireworks proprietary network error → 502', async () => {
		const { fetchFn } = makeTracedFetch([new Error('ECONNREFUSED')]);

		const result = await handleModelsRequest(
			{
				baseUrl: FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(502);
		expect((result.body as { error: string }).error).toContain('ECONNREFUSED');
	});

	test('Authorization header is set on Fireworks proprietary call', async () => {
		const { fetchFn, calls } = makeTracedFetch([jsonResponse({ models: [] })]);

		await handleModelsRequest(
			{
				baseUrl: FIREWORKS_BASE,
				apiKey: 'sk-fw-key',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(calls[0].headers['Authorization']).toBe('Bearer sk-fw-key');
	});
});

test.describe('handleModelsRequest - non-Fireworks error paths (no fallback)', () => {
	test('standard throws network error + non-Fireworks URL → 502 network error', async () => {
		const { fetchFn, calls } = makeTracedFetch([new Error('DNS lookup failed')]);

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: new AbortController().signal
			},
			fetchFn
		);

		// 502 status, error message includes the underlying error.
		expect(result.status).toBe(502);
		expect((result.body as { error: string }).error).toContain('DNS lookup failed');

		// ONE call only — no proprietary fallback for non-Fireworks.
		expect(calls).toHaveLength(1);
	});

	test('standard returns 500 + non-Fireworks URL → 500 with upstream error text', async () => {
		const upstreamErrorText = 'Internal Server Error: rate limit';
		const { fetchFn, calls } = makeTracedFetch([new Response(upstreamErrorText, { status: 500 })]);

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(500);
		expect((result.body as { error: string }).error).toContain('rate limit');
		expect(calls).toHaveLength(1);
	});
});

test.describe('handleModelsRequest - auth failures (non-Fireworks)', () => {
	test('standard returns 401 → "Invalid API key"', async () => {
		const { fetchFn, calls } = makeTracedFetch([
			jsonResponse({ error: { message: 'Invalid API key' } }, 401)
		]);

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-bad',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(401);
		expect((result.body as { error: string }).error).toBe('Invalid API key');
		expect(calls).toHaveLength(1);
	});

	test('standard returns 403 → "Access denied"', async () => {
		const { fetchFn, calls } = makeTracedFetch([
			jsonResponse({ error: { message: 'Forbidden' } }, 403)
		]);

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-no-perm',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(403);
		expect((result.body as { error: string }).error).toContain('Access denied');
		expect(calls).toHaveLength(1);
	});
});

test.describe('handleModelsRequest - response parsing', () => {
	test('upstream returns non-JSON on success → 502 "non-JSON" error', async () => {
		const { fetchFn } = makeTracedFetch([
			new Response('<html><body>Cloudflare error</body></html>', {
				status: 200,
				headers: { 'Content-Type': 'text/html' }
			})
		]);

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(502);
		expect((result.body as { error: string }).error).toContain('non-JSON');
	});

	test('upstream returns empty JSON on success → returns the empty body', async () => {
		const { fetchFn } = makeTracedFetch([jsonResponse({})]);

		const result = await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-test',
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(result.status).toBe(200);
		expect(result.body).toEqual({});
	});
});

test.describe('handleModelsRequest - extraHeaders sanitization (defense-in-depth)', () => {
	test('RESERVED_HEADERS in extraHeaders are stripped before reaching upstream', async () => {
		const { fetchFn, calls } = makeTracedFetch([jsonResponse({ data: [] })]);

		await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: 'sk-test',
				extraHeaders: {
					Authorization: 'Bearer attacker-key', // must be stripped
					'Content-Type': 'multipart/form-data', // must be stripped
					Host: 'evil.com', // must be stripped
					'X-Legit': 'legit-value' // must survive
				},
				signal: new AbortController().signal
			},
			fetchFn
		);

		expect(calls[0].headers['Authorization']).toBe('Bearer sk-test'); // server-set overrides any slip
		expect(calls[0].headers['Content-Type']).toBeUndefined();
		expect(calls[0].headers['Host']).toBeUndefined();
		expect(calls[0].headers['X-Legit']).toBeUndefined(); // lowercased
		expect(calls[0].headers['x-legit']).toBe('legit-value');
	});
});

test.describe('buildUpstreamHeaders - keyless omits Authorization', () => {
	test('empty apiKey → no Authorization header, extra headers preserved', () => {
		const headers = buildUpstreamHeaders('', { 'X-Legit': 'v' });
		expect(headers['Authorization']).toBeUndefined();
		expect(headers['x-legit']).toBe('v'); // sanitized (lowercased) and kept
	});

	test('present apiKey → Authorization: Bearer <key>', () => {
		const headers = buildUpstreamHeaders('sk-x');
		expect(headers['Authorization']).toBe('Bearer sk-x');
	});

	test('whitespace-only apiKey → treated as keyless (no Authorization)', () => {
		// A blank/whitespace key must not become `Authorization: Bearer   `.
		expect(buildUpstreamHeaders('   ')['Authorization']).toBeUndefined();
		expect(buildUpstreamHeaders('\t\n')['Authorization']).toBeUndefined();
	});

	test('apiKey is trimmed inside the Bearer value', () => {
		expect(buildUpstreamHeaders('  sk-x  ')['Authorization']).toBe('Bearer sk-x');
	});
});

test.describe('handleModelsRequest - keyless (empty apiKey)', () => {
	test('no Authorization header sent upstream when keyless', async () => {
		const { fetchFn, calls } = makeTracedFetch([jsonResponse({ data: [] })]);
		await handleModelsRequest(
			{
				baseUrl: NON_FIREWORKS_BASE,
				apiKey: '',
				extraHeaders: { 'X-Legit': 'v' },
				signal: new AbortController().signal
			},
			fetchFn
		);
		expect(calls[0].headers['Authorization']).toBeUndefined();
		expect(calls[0].headers['x-legit']).toBe('v');
	});

	test('keyless upstream 401 → friendly message with NO remap-trigger words', async () => {
		const { fetchFn } = makeTracedFetch([jsonResponse({ error: 'nope' }, 401)]);
		const result = await handleModelsRequest(
			{ baseUrl: NON_FIREWORKS_BASE, apiKey: '', signal: new AbortController().signal },
			fetchFn
		);
		expect(result.status).toBe(401);
		const msg = (result.body as { error: string }).error;
		expect(msg).toBe('This server requires an API key');
		// Must NOT contain substrings that openai.ts verifyServer() rewrites,
		// otherwise the friendly message would be silently clobbered.
		const lower = msg.toLowerCase();
		expect(lower).not.toContain('401');
		expect(lower).not.toContain('invalid api key');
		expect(lower).not.toContain('access denied');
	});

	test('keyed upstream 401 → "Invalid API key" (unchanged)', async () => {
		const { fetchFn } = makeTracedFetch([jsonResponse({ error: 'nope' }, 401)]);
		const result = await handleModelsRequest(
			{ baseUrl: NON_FIREWORKS_BASE, apiKey: 'sk-bad', signal: new AbortController().signal },
			fetchFn
		);
		expect((result.body as { error: string }).error).toBe('Invalid API key');
	});
});
