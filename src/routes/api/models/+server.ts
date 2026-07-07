import { json } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env } from '$env/dynamic/private';

import {
	isKeylessProxyAllowed,
	isLoopbackUrl,
	resolveApiKey,
	validateUpstreamUrl
} from '$lib/server/credentials';
import { handleModelsRequest } from '$lib/server/models-handler';
import { checkOrigin } from '$lib/server/validation';

export async function GET({ url, request }) {
	// Origin gate first: this proxy has no key requirement anymore on the
	// keyless path, so checkOrigin is what stops a cross-origin page from
	// driving it. Runs in ALL modes (including Electron — that's where keyless
	// is enabled and validateUpstreamUrl is off).
	const originError = checkOrigin(request);
	if (originError) return originError;

	const baseUrl = url.searchParams.get('baseUrl');
	if (!baseUrl) {
		return json({ error: 'baseUrl query parameter is required', status: 400 }, { status: 400 });
	}

	const isDesktop = publicEnv.PUBLIC_ADAPTER === 'electron-node';
	if (!isDesktop) {
		const urlError = validateUpstreamUrl(baseUrl);
		if (urlError) {
			return json({ error: urlError, status: 403 }, { status: 403 });
		}
	}

	const headerKey = request.headers.get('x-api-key') || undefined;
	const creds = resolveApiKey(baseUrl, env.OPENAI_API_KEY, headerKey);
	if (!creds) {
		// No key. In web/docker mode this stays a hard 401 (the proxy is not an
		// open relay). On desktop, allow keyless — but ONLY to a loopback upstream
		// (a local llama.cpp), so a missing key can't be abused to reach the LAN,
		// link-local/metadata, or arbitrary hosts.
		if (!isKeylessProxyAllowed(isDesktop)) {
			return json({ error: 'No API key available', status: 401 }, { status: 401 });
		}
		if (!isLoopbackUrl(baseUrl)) {
			return json(
				{
					error:
						'Keyless connections are only allowed for local (loopback) servers — add an API key for remote servers',
					status: 400
				},
				{ status: 400 }
			);
		}
	}

	// Delegate the fetch orchestration (standard → Fireworks fallback,
	// pagination, error mapping) to a unit-testable handler. The route
	// stays responsible only for input validation and credential
	// resolution (env-dependent) so the orchestration is decoupled from
	// the request envelope.
	const result = await handleModelsRequest({
		baseUrl,
		apiKey: creds?.apiKey ?? '',
		extraHeaders: creds?.extraHeaders,
		signal: request.signal
	});

	return json(result.body, { status: result.status });
}
