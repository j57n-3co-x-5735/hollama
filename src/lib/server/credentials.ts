import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeHeaders } from '$lib/connections';

export interface ServerCredentials {
	apiKey: string;
	extraHeaders?: Record<string, string>;
	/** True when the apiKey was sourced from a per-request x-api-key header.
	 *  Header-supplied credentials are not persisted across requests; this marker
	 *  is used by resolveApiKey to detect stale auto-cached entries on rotation.
	 *
	 *  Currently informational -- no caller reads it. It exists for future
	 *  observability (e.g. metrics counters, debug logging on rotation
	 *  patterns). Can be removed without affecting current callers. */
	fromHeader?: boolean;
}

const store = new Map<string, ServerCredentials>();

/** Hostnames or address ranges the server will refuse to fetch.
 *  SSRF protection: blocks cloud metadata endpoints, loopback, link-local,
 *  and RFC 1918 private network ranges on both IPv4 and IPv6. */
const RESTRICTED_HOSTNAMES = new Set([
	'0.0.0.0',
	// The IPv6 unspecified address (all zeros). It is NOT loopback, but binding/
	// routing to it commonly reaches loopback services, so block it for SSRF the
	// same way 0.0.0.0 is blocked (and keep it out of the keyless loopback gate).
	'::',
	'0:0:0:0:0:0:0:0',
	'169.254.169.254',
	'metadata.google.internal',
	'metadata'
]);

const RESTRICTED_SUFFIXES = ['.internal', '.local'];

function isIPv4(s: string): boolean {
	const parts = s.split('.');
	if (parts.length !== 4) return false;
	for (const p of parts) {
		if (!/^\d+$/.test(p)) return false;
		const n = Number(p);
		if (n < 0 || n > 255) return false;
	}
	return true;
}

function isLoopbackIPv4(host: string): boolean {
	if (!isIPv4(host)) return false;
	const parts = host.split('.').map(Number);
	return parts[0] === 127;
}

function isPrivateIPv4(host: string): boolean {
	if (!isIPv4(host)) return false;
	const parts = host.split('.').map(Number);
	// 10.0.0.0/8
	if (parts[0] === 10) return true;
	// 172.16.0.0/12
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	// 192.168.0.0/16
	if (parts[0] === 192 && parts[1] === 168) return true;
	// 169.254.0.0/16 (link-local — cloud metadata lives here)
	if (parts[0] === 169 && parts[1] === 254) return true;
	// 100.64.0.0/10 (carrier-grade NAT)
	if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
	return false;
}

function isLoopbackIPv6(host: string): boolean {
	// Loopback is ::1 only (with or without brackets, or fully expanded). The
	// unspecified address :: (all zeros) is deliberately NOT loopback — it means
	// "any/all interfaces", not a same-machine target, so it must not open the
	// keyless proxy. :: is blocked separately as a restricted host (SSRF).
	return host === '::1' || host === '0:0:0:0:0:0:0:1';
}

function isPrivateIPv6(host: string): boolean {
	// fc00::/7 — unique local addresses (RFC 4193)
	if (/^f[cd]/i.test(host)) return true;
	// fe80::/10 — link-local
	if (/^fe[89ab]/i.test(host)) return true;
	// ::ffff:a.b.c.d — IPv4-mapped IPv6; format normalized by URL parser to either
	// dotted form (when the input was already dotted) OR hex-hex form (when input
	// was hex or already hex). Block any ::ffff: form unconditionally and let the
	// top-level ::ffff: guard reject these before this function is called.
	const mappedMatch = host.match(/^::ffff:([0-9.]+)$/i);
	if (mappedMatch && isIPv4(mappedMatch[1])) {
		const embedded = mappedMatch[1];
		return isLoopbackIPv4(embedded) || isPrivateIPv4(embedded);
	}
	return false;
}

export function validateUpstreamUrl(baseUrl: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return 'Invalid URL';
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) return 'Only HTTP(S) URLs allowed';

	// Reject URL forms that bypass hostname checks (e.g. http://[::1]@host).
	// The constructor rejects credentials in URLs, but defense-in-depth.
	if (parsed.username || parsed.password) return 'URL contains credentials';

	const host = parsed.hostname.toLowerCase().replace(/^\[|]$/g, '');

	// Block ANY IPv4-mapped IPv6 (::ffff:*) - SSRF hardening. Node's URL parser
	// normalizes ::ffff:127.0.0.1 to hostname "[::ffff:7f00:1]" (hex-hex form,
	// since dots aren't valid hex), so a regex matching only dotted form would
	// miss the canonical form. Block unconditionally: IPv4-mapped IPv6 is a
	// dual-stack transition mechanism, and any IPv4 endpoint is reachable
	// directly via IPv4. There is no legitimate need to reach a public IPv4
	// host via ::ffff:* wrapping.
	if (/^::ffff:/i.test(host)) return 'IPv4-mapped IPv6 addresses not allowed';

	// Literal "localhost" first (case-insensitive, with/without trailing dot)
	if (host === 'localhost' || host === 'localhost.') return 'URL points to a restricted address';

	if (RESTRICTED_HOSTNAMES.has(host)) return 'URL points to a restricted address';

	for (const suffix of RESTRICTED_SUFFIXES) {
		if (host.endsWith(suffix)) return 'URL points to a restricted address';
	}

	if (isLoopbackIPv4(host) || isPrivateIPv4(host)) {
		return 'URL points to a restricted address';
	}

	if (isLoopbackIPv6(host) || isPrivateIPv6(host)) {
		return 'URL points to a restricted address';
	}

	return null;
}

/** True iff `baseUrl`'s host is loopback (127.0.0.0/8, ::1, or the literal
 *  "localhost"). Reuses the loopback predicates above. Used to fence keyless
 *  proxying to same-machine servers only: a keyless request may reach the
 *  user's own loopback but never the LAN, link-local/metadata, or arbitrary
 *  hosts (see isKeylessProxyAllowed and the proxy routes). */
export function isLoopbackUrl(baseUrl: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return false;
	}
	const host = parsed.hostname.toLowerCase().replace(/^\[|]$/g, '');
	if (host === 'localhost' || host === 'localhost.') return true;
	return isLoopbackIPv4(host) || isLoopbackIPv6(host);
}

/** Keyless upstream proxying (forwarding with no Authorization header when no
 *  key resolves) is permitted only on desktop (Electron): there the server
 *  binds to 127.0.0.1 and `validateUpstreamUrl` is skipped, and the proxy
 *  routes enforce `checkOrigin` + `isLoopbackUrl`. In web/docker mode a missing
 *  key must stay a hard 401 so the proxy never becomes an unauthenticated
 *  open relay. */
export function isKeylessProxyAllowed(isDesktop: boolean): boolean {
	return isDesktop;
}

export function getCredentials(baseUrl: string): ServerCredentials | undefined {
	return store.get(baseUrl);
}

export function setCredentials(baseUrl: string, creds: ServerCredentials): void {
	store.set(baseUrl, {
		apiKey: creds.apiKey,
		extraHeaders: sanitizeHeaders(creds.extraHeaders)
	});
	persistStore();
}

export function deleteCredentials(baseUrl: string): boolean {
	const deleted = store.delete(baseUrl);
	if (deleted) persistStore();
	return deleted;
}

// Persistence: the credential store survives server restart. Keys are written
// to a JSON file. The file stores only credentials set via /api/keys; env-
// supplied keys (OPENAI_API_KEY) are not persisted here — they're already
// persistent via the env var. Header-supplied keys are not stored here
// (see resolveApiKey — auto-caching creates a stale-credential hazard).
const DATA_DIR = process.env.HOLLAMA_DATA_DIR || join(process.cwd(), '.hollama');
const STORE_FILE = join(DATA_DIR, 'credentials.json');

let persistLoaded = false;

function loadPersistedStore(): void {
	if (persistLoaded) return;
	persistLoaded = true;
	try {
		if (!existsSync(STORE_FILE)) return;
		const raw = readFileSync(STORE_FILE, 'utf-8');
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || typeof parsed.credentials !== 'object') return;
		for (const [url, creds] of Object.entries(parsed.credentials as Record<string, unknown>)) {
			if (!creds || typeof creds !== 'object') continue;
			const apiKey = (creds as Record<string, unknown>).apiKey;
			if (typeof apiKey !== 'string' || !apiKey) continue;
			const extraHeaders = (creds as Record<string, unknown>).extraHeaders;
			store.set(url, {
				apiKey,
				// Defense-in-depth: re-sanitize on the persistence boundary, not
				// only at the input boundary in setCredentials. A corrupted file
				// (partial write, co-tenant modification) could otherwise inject
				// RESERVED_HEADERS or control chars here.
				extraHeaders:
					extraHeaders && typeof extraHeaders === 'object'
						? sanitizeHeaders(extraHeaders as Record<string, string>)
						: undefined
			});
		}
	} catch (err) {
		console.warn('Failed to load persisted credentials:', err);
	}
}

function persistStore(): void {
	try {
		if (!existsSync(DATA_DIR)) {
			mkdirSync(DATA_DIR, { recursive: true });
		}
		// Atomically write via temp + rename so a crash mid-write can't corrupt.
		const tmp = STORE_FILE + '.tmp';
		const payload = JSON.stringify({ credentials: Object.fromEntries(store) }, null, 2);
		writeFileSync(tmp, payload, { mode: 0o600, encoding: 'utf-8' });
		renameSync(tmp, STORE_FILE);
	} catch (err) {
		console.warn('Failed to persist credentials to disk:', err);
	}
}

// Load any persisted credentials from disk before resolving the first
// request, so restarted servers don't lose /api/keys-managed credentials.
// Called after all declarations so the const-bound DATA_DIR/STORE_FILE and
// persistLoaded are initialized (otherwise the function body would hit a TDZ).
loadPersistedStore();

export function resolveApiKey(
	baseUrl: string,
	envKey: string | undefined,
	headerKey: string | undefined
): ServerCredentials | undefined {
	// The global OPENAI_API_KEY is for the hosted (non-loopback) OpenAI/compatible
	// proxy. Deliberately NOT applied to a loopback (local) server the user runs
	// keyless — otherwise a local llama.cpp receives `Authorization: Bearer
	// <envkey>` it never asked for, leaking the hosted-provider key to a local
	// process. A loopback server with an explicitly-stored key still uses it
	// (handled by the store lookup below).
	if (envKey && !isLoopbackUrl(baseUrl)) {
		const stored = store.get(baseUrl);
		return { apiKey: envKey, extraHeaders: stored?.extraHeaders };
	}

	const stored = store.get(baseUrl);
	if (stored) return stored;

	// Header-supplied keys are returned per-request WITHOUT being cached in the
	// store. Auto-caching them creates a stale-credential hazard on key rotation:
	// the next request after rotation would still receive the prior header value
	// from the cache.
	//
	// Merge any stored extraHeaders with the per-request header key: the user
	// has explicitly configured those headers in the Settings UI
	// and expects them to flow through to upstream regardless of auth mode. The
	// keys will be sanity-checked by the persistence path's sanitizeHeaders
	// call on load.
	if (headerKey) {
		const stored = store.get(baseUrl);
		// fromHeader observability: operators can confirm header-mode auth is
		// firing by enabling SvelteKit debug logs.
		console.debug(`[credentials] resolveApiKey: header-mode auth for ${baseUrl} (fromHeader=true)`);
		return {
			apiKey: headerKey,
			extraHeaders: stored?.extraHeaders,
			fromHeader: true
		};
	}

	return undefined;
}
