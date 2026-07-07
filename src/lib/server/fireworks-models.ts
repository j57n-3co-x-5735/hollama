/** Fireworks proprietary model-listing helper.
 *  Extracted from `src/routes/api/models/+server.ts` so it can be unit-tested
 *  with an injected fetcher. Production callers use the default global fetch.
 *
 *  Firework's public OpenAI-compatible `/v1/models` route does not cover all
 *  serverless hosted models. The proprietary API at
 *  `/v1/accounts/fireworks/models` returns a paged list of model names.
 *  This module is the fallback path that the proxy endpoint takes when the
 *  standard `/models` request fails.
 *
 *  Trust contract:
 *  - `upstreamHeaders` MUST already be sanitized by the caller (sanitizeHeaders).
 *    This module does not re-sanitize. The endpoint sets `Authorization` itself.
 *  - The fetcher signature MUST match `typeof fetch`. The default falls back to
 *    global fetch.
 *  - Return shape is intentionally Response-like (`status`, `body`) so the
 *    caller can wrap with `json()` exactly as the route handler does today.
 */

export interface FireworksModelListResult {
	status: number;
	/** The OpenAI-compat-shaped response body when the upstream succeeded. */
	data?: { data: Array<{ id: string; object: string }> };
	/** The error body when upstream failed. */
	error?: string;
}

const MAX_PAGES = 10;
const PAGE_SIZE = 200;

/** Fetch the Fireworks proprietary model list, handling pagination.
 *  The proprietary endpoint at `/v1/accounts/fireworks/models` returns a
 *  paged response — keep fetching with `nextPageToken` until exhausted
 *  or the page cap (10) is hit (defense against runaway pagination).
 *
 *  @param baseUrl The Fireworks base URL (e.g. https://api.fireworks.ai/inference/v1).
 *                 The origin is extracted and used; the path is replaced.
 *  @param upstreamHeaders Sanitized headers (must include Authorization).
 *  @param signal AbortSignal forwarded from the inbound request.
 *  @param fetchFn Injectable fetcher (defaults to global fetch). The parameter
 *                 exists for unit testing — production should never pass a
 *                 non-default value. */
export async function fetchFireworksModels(
	baseUrl: string,
	upstreamHeaders: Record<string, string>,
	signal: AbortSignal,
	fetchFn: typeof fetch = fetch
): Promise<FireworksModelListResult> {
	const allModels: Array<{ id: string; object: string }> = [];
	let pageToken: string | undefined;
	let pages = 0;

	let proprietaryBase: string;
	try {
		proprietaryBase = new URL(baseUrl).origin;
	} catch {
		return { status: 502, error: 'Fireworks model listing failed: invalid baseUrl' };
	}

	do {
		const url = new URL(`${proprietaryBase}/v1/accounts/fireworks/models`);
		url.searchParams.set('pageSize', String(PAGE_SIZE));
		if (pageToken) url.searchParams.set('pageToken', pageToken);

		let response: Response;
		try {
			response = await fetchFn(url.toString(), { headers: upstreamHeaders, signal });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Network error';
			return {
				status: 502,
				error: `Fireworks model listing failed: ${message}`
			};
		}

		if (!response.ok) {
			let errorText: string;
			try {
				errorText = await response.text();
			} catch {
				errorText = `Upstream error ${response.status}`;
			}
			return {
				status: response.status,
				error: `Fireworks model listing failed: ${response.status} ${errorText}`
			};
		}

		let data: Record<string, unknown>;
		try {
			data = (await response.json()) as Record<string, unknown>;
		} catch {
			return { status: 502, error: 'Fireworks model listing returned non-JSON response' };
		}

		if (!Array.isArray(data?.models)) {
			return {
				status: 502,
				error: 'Fireworks model listing returned unexpected response shape'
			};
		}

		const models = (data.models as Array<Record<string, unknown>>)
			.filter((m): m is Record<string, unknown> => Boolean(m.name) && typeof m.name === 'string')
			.map((m) => ({ id: m.name as string, object: 'model' }));

		allModels.push(...models);
		pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
		pages++;
	} while (pageToken && pages < MAX_PAGES);

	return { status: 200, data: { data: allModels } };
}
