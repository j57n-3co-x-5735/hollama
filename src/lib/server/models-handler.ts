import { sanitizeHeaders } from '$lib/connections';

import { fetchFireworksModels, type FireworksModelListResult } from './fireworks-models';

/** Orchestration logic for the `/api/models` proxy endpoint.
 *  Extracted from `src/routes/api/models/+server.ts` so it can be unit-tested
 *  with an injected fetcher. The route handler is a thin wrapper that
 *  resolves credentials and delegates here.
 *
 *  Trust contract (must not regress):
 *  - `apiKey`: opaque. The caller has resolved credentials; we accept the
 *    resolved value and don't second-guess the resolution order.
 *  - `extraHeaders`: re-sanitized on the way out. This is the explicit
 *    trust boundary between user-supplied config (stored, import-time,
 *    persistence-time) and the upstream HTTP request. If a future change
 *    moves the trust boundary up the stack, this re-sanitization must
 *    be preserved *or* a caller comment must document why it was removed.
 *  - `fetchFn`: defaults to global fetch. Production uses default; tests
 *    inject a mock.
 */

type FetchFn = typeof fetch;

export interface ModelsRequest {
	baseUrl: string;
	apiKey: string;
	extraHeaders?: Record<string, string>;
	signal: AbortSignal;
}

export interface ModelsResponse {
	status: number;
	body: unknown;
}

/** Build the upstream HTTP headers for the proxy request.
 *  - Re-sanitizes extraHeaders at this boundary (defense-in-depth).
 *  - Sets Authorization last (so a sanitized equivalent cannot override it),
 *    and only when a key is present — a keyless upstream (local llama.cpp) must
 *    not receive a blank `Authorization: Bearer ` header. */
export function buildUpstreamHeaders(
	apiKey: string,
	extraHeaders?: Record<string, string>
): Record<string, string> {
	const headers: Record<string, string> = {};
	const safe = sanitizeHeaders(extraHeaders);
	if (safe) Object.assign(headers, safe);
	// Trim first: a whitespace-only key must be treated as "no key" (keyless),
	// not forwarded as a meaningless `Authorization: Bearer    ` header.
	const trimmedKey = apiKey.trim();
	if (trimmedKey) headers['Authorization'] = `Bearer ${trimmedKey}`;
	return headers;
}

function isFireworks(baseUrl: string): boolean {
	return baseUrl.toLowerCase().includes('fireworks.ai');
}

/** Wrap a `FireworksModelListResult` in the same wire envelope the route
 *  handler returns. The route contract (status, body) is preserved.
 *  - success: `{ data: Array<{id,object}> }` from upstream
 *  - error:   `{ error: string }` mirroring the upstream error */
function wireFireworksResult(result: FireworksModelListResult): ModelsResponse {
	if (result.data) return { status: result.status, body: result.data };
	return { status: result.status, body: { error: result.error } };
}

/** Orchestrate the model-listing endpoint:
 *  1. Validate baseUrl (404 → 400 if missing, restricted → 403).
 *  2. Build sanitized upstream headers.
 *  3. Try the standard `/v1/models` route.
 *     - On network error or non-401/403 status for Fireworks URLs, fall
 *       back to the proprietary `/v1/accounts/fireworks/models` route.
 *     - 401 → "Invalid API key" (do NOT fall back; auth failure must
 *       surface to the user).
 *     - 403 → "Access denied" (do NOT fall back).
 *  4. Return upstream JSON body verbatim on success.
 *
 *  @param req the request envelope (baseUrl, credentials, signal)
 *  @param fetchFn injectable fetcher (defaults to global fetch) */
export async function handleModelsRequest(
	req: ModelsRequest,
	fetchFn: FetchFn = fetch
): Promise<ModelsResponse> {
	const { baseUrl, signal } = req;

	if (!baseUrl) {
		return {
			status: 400,
			body: { error: 'baseUrl query parameter is required', status: 400 }
		};
	}

	const upstreamHeaders = buildUpstreamHeaders(req.apiKey, req.extraHeaders);

	// Fireworks: go directly to the proprietary paginated endpoint.
	// The standard /v1/models returns an incomplete model list for Fireworks.
	if (isFireworks(baseUrl)) {
		const result = await fetchFireworksModels(baseUrl, upstreamHeaders, signal, fetchFn);
		return wireFireworksResult(result);
	}

	let upstream: Response;
	try {
		upstream = await fetchFn(`${baseUrl}/models`, {
			headers: upstreamHeaders,
			signal
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Network error';
		return { status: 502, body: { error: message, status: 502 } };
	}

	if (upstream.ok) {
		let data: unknown;
		try {
			data = await upstream.json();
		} catch {
			return {
				status: 502,
				body: { error: 'Upstream returned non-JSON response', status: 502 }
			};
		}
		return { status: upstream.status, body: data };
	}

	if (upstream.status === 401) {
		// A keyless request (empty apiKey) the upstream rejected → it actually
		// needs a key. Distinct message with NO 'invalid api key'/'401'/'access
		// denied' trigger words, so openai.ts verifyServer() surfaces it verbatim
		// instead of rewriting it to the canned "Invalid API key".
		const message = req.apiKey ? 'Invalid API key' : 'This server requires an API key';
		return { status: 401, body: { error: message, status: 401 } };
	}
	if (upstream.status === 403) {
		return {
			status: 403,
			body: { error: 'Access denied — check API key permissions', status: 403 }
		};
	}

	let errorText: string;
	try {
		errorText = await upstream.text();
	} catch {
		errorText = `Upstream error ${upstream.status}`;
	}
	return {
		status: upstream.status,
		body: { error: errorText, status: upstream.status }
	};
}
