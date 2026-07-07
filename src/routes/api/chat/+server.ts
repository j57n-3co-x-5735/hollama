import { json } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env } from '$env/dynamic/private';

import {
	isKeylessProxyAllowed,
	isLoopbackUrl,
	resolveApiKey,
	validateUpstreamUrl
} from '$lib/server/credentials';
import { buildUpstreamHeaders } from '$lib/server/models-handler';
import { checkOrigin } from '$lib/server/validation';

export async function POST({ request }) {
	// Origin gate first — before parsing the body — so a cross-origin request
	// (with any body) gets 403, not 400. This is the access gate that replaced
	// the key requirement on the keyless path; runs in all modes.
	const originError = checkOrigin(request);
	if (originError) return originError;

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body', status: 400 }, { status: 400 });
	}

	const { baseUrl, model, messages, sessionAffinityKey, reasoningEffort } = body as {
		baseUrl?: string;
		model?: string;
		messages?: unknown[];
		sessionAffinityKey?: string;
		reasoningEffort?: string;
	};

	if (!baseUrl || typeof baseUrl !== 'string') {
		return json({ error: 'baseUrl is required', status: 400 }, { status: 400 });
	}
	const isDesktop = publicEnv.PUBLIC_ADAPTER === 'electron-node';
	if (!isDesktop) {
		const urlError = validateUpstreamUrl(baseUrl);
		if (urlError) {
			return json({ error: urlError, status: 403 }, { status: 403 });
		}
	}
	if (!model || typeof model !== 'string') {
		return json({ error: 'model is required', status: 400 }, { status: 400 });
	}
	if (!messages || !Array.isArray(messages) || messages.length === 0) {
		return json({ error: 'messages must be a non-empty array', status: 400 }, { status: 400 });
	}

	const headerKey = request.headers.get('x-api-key') || undefined;
	const creds = resolveApiKey(baseUrl, env.OPENAI_API_KEY, headerKey);
	if (!creds) {
		// Mirror /api/models: web/docker keep a hard 401; desktop allows keyless
		// only to a loopback upstream (local llama.cpp).
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

	const upstreamBody: Record<string, unknown> = {
		model,
		messages,
		stream: true
	};
	if (sessionAffinityKey) {
		upstreamBody.prompt_cache_key = sessionAffinityKey;
	}
	if (reasoningEffort) {
		upstreamBody.reasoning_effort = reasoningEffort;
	}

	// Trust contract (shared with /api/models via buildUpstreamHeaders): the
	// proxy is the explicit boundary between user-supplied config and the
	// upstream request. extraHeaders are re-sanitized here (defense-in-depth —
	// strips RESERVED_HEADERS/control chars even if an upstream step regressed),
	// and Authorization is set last and ONLY when a key is present — a keyless
	// local server receives no Authorization header. Content-Type is set last.
	const upstreamHeaders = buildUpstreamHeaders(creds?.apiKey ?? '', creds?.extraHeaders);
	upstreamHeaders['Content-Type'] = 'application/json';

	let upstream: Response;
	try {
		upstream = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: upstreamHeaders,
			body: JSON.stringify(upstreamBody),
			signal: request.signal
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Network error';
		return json({ error: message, status: 502 }, { status: 502 });
	}

	if (!upstream.ok) {
		let errorText: string;
		try {
			errorText = await upstream.text();
		} catch {
			errorText = `Upstream error ${upstream.status}`;
		}
		// Keyless request the upstream rejected → it actually needs a key.
		// Surface a friendly message (parity with /api/models).
		if (upstream.status === 401 && !creds) {
			errorText = 'This server requires an API key';
		}
		return json({ error: errorText, status: upstream.status }, { status: upstream.status });
	}

	return new Response(upstream.body, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
}
