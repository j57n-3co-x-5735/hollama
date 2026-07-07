import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/public';
import { deleteCredentials, setCredentials } from '$lib/server/credentials';
import { checkOrigin } from '$lib/server/validation';

export async function POST({ request }) {
	const isDesktop = env.PUBLIC_ADAPTER === 'electron-node';
	if (!isDesktop) {
		const originError = checkOrigin(request);
		if (originError) {
			return originError;
		}
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body', status: 400 }, { status: 400 });
	}

	const { baseUrl, apiKey, extraHeaders } = body;

	if (!baseUrl || typeof baseUrl !== 'string') {
		return json({ error: 'baseUrl is required', status: 400 }, { status: 400 });
	}
	if (!apiKey || typeof apiKey !== 'string') {
		return json({ error: 'apiKey is required', status: 400 }, { status: 400 });
	}

	setCredentials(baseUrl, { apiKey, extraHeaders: extraHeaders as Record<string, string> });
	return json({ ok: true });
}

export async function DELETE({ request }) {
	const isDesktop = env.PUBLIC_ADAPTER === 'electron-node';
	if (!isDesktop) {
		const originError = checkOrigin(request);
		if (originError) {
			return originError;
		}
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body', status: 400 }, { status: 400 });
	}

	const { baseUrl } = body;

	if (!baseUrl || typeof baseUrl !== 'string') {
		return json({ error: 'baseUrl is required', status: 400 }, { status: 400 });
	}

	deleteCredentials(baseUrl);
	return json({ ok: true });
}
