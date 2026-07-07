import { env } from '$env/dynamic/public';

import { isValidCspSource } from '$lib/server/validation';

function validateExtraConnectSources(raw: string): { sources: string[]; dropped: string[] } {
	const tokens = raw.split(/\s+/).filter(Boolean);
	const sources: string[] = [];
	const dropped: string[] = [];
	for (const t of tokens) {
		if (isValidCspSource(t)) {
			sources.push(t);
		} else {
			dropped.push(t);
		}
	}
	return { sources, dropped };
}

export async function handle({ event, resolve }) {
	const response = await resolve(event);

	const extraSourcesRaw = env.PUBLIC_CSP_CONNECT_SOURCES;
	if (extraSourcesRaw) {
		const { sources, dropped } = validateExtraConnectSources(extraSourcesRaw);
		if (dropped.length > 0) {
			// Surface the rejection so operators can debug typos like a missing
			// scheme. List the dropped tokens (operator wrote them; this is a
			// server-side log, not exposed to clients). Truncate to avoid
			// log-spam if someone sets the env var to a long string.
			const sample = dropped.slice(0, 5).join(', ');
			const suffix = dropped.length > 5 ? `, …and ${dropped.length - 5} more` : '';
			console.warn(
				`PUBLIC_CSP_CONNECT_SOURCES: dropped ${dropped.length} invalid token(s) rejected by CSP source grammar (likely contains ';' or characters outside the URL/keyword grammar): ${sample}${suffix}`
			);
		}
		if (sources.length > 0) {
			const existing = response.headers.get('content-security-policy') || '';
			if (!/connect-src\b/.test(existing)) {
				// No connect-src directive present; the configured sources would
				// silently no-op. Append a fresh connect-src directive so the
				// operator's intent isn't dropped on the floor.
				const separator = existing ? '; ' : '';
				response.headers.set(
					'content-security-policy',
					existing + separator + `connect-src ${sources.join(' ')}`
				);
			} else {
				const updated = existing.replace(
					/(connect-src )([^;]+)/,
					(_match: string, prefix: string, list: string) =>
						`${prefix}${list} ${sources.join(' ')}`
				);
				if (updated !== existing) {
					response.headers.set('content-security-policy', updated);
				}
			}
		}
	}

	return response;
}
