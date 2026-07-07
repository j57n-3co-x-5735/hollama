import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { json } from '@sveltejs/kit';

export function isValidCspSource(source: string): boolean {
	if (!source) return false;
	return /^[\w\-._~:/%@?!&=+*'#[\]]+$/.test(source);
}

export function checkOrigin(request: Request): Response | null {
	const origin = request.headers.get('origin');
	const host = request.headers.get('host');
	if (!origin || !host) return null;

	let originUrl: URL;
	try {
		originUrl = new URL(origin);
	} catch {
		return json({ error: 'Invalid origin header' }, { status: 403 }) as Response;
	}

	const colonCount = (host.match(/:/g) || []).length;
	let expectedHost: string;
	let expectedPort = '';
	if (colonCount === 0) {
		expectedHost = host;
	} else if (colonCount === 1 && !host.startsWith('[')) {
		const idx = host.indexOf(':');
		expectedHost = host.slice(0, idx);
		expectedPort = host.slice(idx + 1);
	} else {
		const ipv6Match = host.match(/^\[(.+)](?::(\d+))?$/);
		if (!ipv6Match) {
			return json(
				{ error: 'Malformed Host header cannot be validated' },
				{ status: 400 }
			) as Response;
		}
		expectedHost = ipv6Match[1];
		expectedPort = ipv6Match[2] ?? '';
	}

	// The WHATWG URL parser returns IPv6 hostnames in bracketed form (`[::1]`),
	// while the Host-header IPv6 branch above captures the address without
	// brackets (`::1`). Normalize both to the unbracketed form so a legitimate
	// IPv6 same-origin request (`Origin: http://[::1]:5173`, `Host: [::1]:5173`)
	// is not wrongly rejected on a spurious `[::1]` !== `::1` mismatch.
	const originHostname = originUrl.hostname.replace(/^\[|\]$/g, '');
	if (originHostname !== expectedHost) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 }) as Response;
	}

	const isHttps = originUrl.protocol === 'https:';
	const originPort = originUrl.port || (isHttps ? '443' : '80');
	const wantedPort = expectedPort || (isHttps ? '443' : '80');
	if (originPort !== wantedPort) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 }) as Response;
	}

	// Scheme consistency. The Host header carries no scheme, so it can only be
	// inferred from the port when the port is a well-known scheme default:
	// `:443` must be https, `:80` must be http. A NON-standard explicit port
	// (`:8443`, `:5173`, `:1234`, …) does NOT imply a scheme — 8443 is commonly
	// https, 5173 is http — so the earlier host+port equality is the same-origin
	// guarantee and the scheme is left unconstrained here. (A browser cannot forge
	// the Origin scheme for a page anyway: an http page's requests carry an http
	// Origin, and mixed-content rules block http↔https to the same host:port.)
	// Previously this rejected EVERY non-443 port paired with an https Origin,
	// which 403'd a legitimate same-origin HTTPS deployment on e.g. :8443.
	if (expectedPort === '443' && !isHttps) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 }) as Response;
	}
	if (expectedPort === '80' && isHttps) {
		return json({ error: 'Cross-origin request rejected' }, { status: 403 }) as Response;
	}

	// Port-less Host: the port carried no scheme signal (the :443/:80 gate above
	// didn't fire), so an http Origin would otherwise pass against an https
	// deployment on a standard port behind a reverse proxy that strips the port.
	// Infer the server's scheme from the request URL (adapter-node builds it from
	// ORIGIN / PROTOCOL_HEADER) and require the Origin's scheme to match.
	if (!expectedPort) {
		let serverIsHttps = false;
		try {
			serverIsHttps = new URL(request.url).protocol === 'https:';
		} catch {
			serverIsHttps = false;
		}
		// Reject ONLY the unsafe direction: the server is KNOWN https (request URL
		// scheme, which adapter-node derives from ORIGIN/PROTOCOL_HEADER) but the
		// Origin is http — an http page can't be same-origin with an https
		// deployment. The reverse (server *appears* http, Origin https) is NOT
		// rejected: that's either mixed-content-blocked by the browser or an https
		// deployment that didn't set ORIGIN, and false-rejecting a legitimate https
		// same-origin request there is worse than the browser-blocked risk.
		if (serverIsHttps && !isHttps) {
			return json({ error: 'Cross-origin request rejected' }, { status: 403 }) as Response;
		}
	}

	return null;
}

export type FilePathValidationResult = { error: string } | { error: null; canonicalPath: string };

// Belt layer ahead of realpathSync: these are neutralized by path
// resolution anyway, but rejecting them early produces an unambiguous
// signal rather than relying solely on the containment check downstream.
const TRAVERSAL_PATTERN = /\.\.[/\\]|%2e|%5c|%2f/i;

/** Containment test used by both the pre-resolve (lexical) and post-resolve
 * (canonical) gates. The trailing separator prevents an allowed dir
 * `/home/user` from matching a sibling like `/home/user-evil`. */
function isWithinAllowedDirs(candidate: string, allowedDirs: string[]): boolean {
	return allowedDirs.some((dir) => candidate === dir || candidate.startsWith(dir + '/'));
}

/**
 * Validates a user-supplied filesystem path against a fixed allowlist of
 * directories, applying the layered checks documented inline below (Layer 0
 * through Layer 7). Returns the canonicalized path on success — callers MUST
 * use that canonical form for all filesystem operations (never the raw input),
 * which closes the TOCTOU window between validation and use.
 */
export function validateFilePath(
	requestedPath: string,
	allowedDirs: string[]
): FilePathValidationResult {
	// Layer 0: feature gate — fail closed, never fall back to a default directory.
	if (allowedDirs.length === 0) {
		return { error: 'File access is not configured' };
	}

	// Layer 1: input presence — prevents path.resolve('') from resolving to cwd.
	if (!requestedPath || !requestedPath.trim()) {
		return { error: 'Path is required' };
	}

	// Layer 2: null byte injection — can truncate strings at the C layer,
	// causing path.resolve to see a different path than the OS open() call.
	if (requestedPath.includes('\x00')) {
		return { error: 'Path contains invalid characters' };
	}

	// Layer 3: traversal pattern regex (pre-resolve).
	if (TRAVERSAL_PATTERN.test(requestedPath)) {
		return { error: 'Path contains invalid characters' };
	}

	// Layer 4: absolute path requirement — relative paths would resolve
	// against cwd, which is deployment-dependent.
	if (!requestedPath.startsWith('/')) {
		return { error: 'Absolute path required' };
	}

	// Layer 4.5: lexical containment pre-check. Resolve the path WITHOUT
	// touching the filesystem and require the result to sit inside an allowed
	// dir before realpathSync runs. This closes a filesystem-wide existence
	// oracle: without it, realpathSync runs on any host path, so a nonexistent
	// path returns 'Path not accessible' (404) while an existing-but-disallowed
	// path (e.g. /etc/passwd) reaches the containment check and returns 'Access
	// denied' (403) — letting a caller probe for the existence of arbitrary
	// host files. With it, anything outside the allowlist returns a uniform
	// 'Access denied' regardless of whether it exists. Symlink escapes
	// (lexically inside an allowed dir, real target outside) still pass here
	// and are caught by the post-realpath containment check in Layer 6.
	const lexicalPath = resolvePath(requestedPath);
	if (!isWithinAllowedDirs(lexicalPath, allowedDirs)) {
		return { error: 'Access denied' };
	}

	// Layer 5: canonicalize, following all symlinks. A symlink inside an
	// allowed directory that points outside it resolves to its real target
	// here, so the containment check below still catches it. Because Layer 4.5
	// already proved the lexical path is in-tree, a realpathSync failure here
	// is a missing entry inside an allowed dir — safe to report as such.
	let canonicalPath: string;
	try {
		canonicalPath = realpathSync(lexicalPath);
	} catch {
		// Generic message — doesn't reveal whether the path exists.
		return { error: 'Path not accessible' };
	}

	// Layer 6: containment check (the primary security gate) on the fully
	// resolved path — this is what catches symlink escapes that passed 4.5.
	if (!isWithinAllowedDirs(canonicalPath, allowedDirs)) {
		return { error: 'Access denied' };
	}

	// Layer 7: post-canonical sanity check — guards against a hypothetical
	// bug in the realpath implementation letting a traversal segment through.
	if (canonicalPath.includes('/../') || canonicalPath.endsWith('/..')) {
		return { error: 'Access denied' };
	}

	return { error: null, canonicalPath };
}

/** True if any path segment strictly below its containing allowed root begins
 * with a dot. The directory-listing route hides dotfiles from its output, but
 * without this a caller could still read or list them by direct path (e.g.
 * `/allowed/.env`, or `/allowed/.git/config`) — so both file routes apply this
 * to keep the dotfile exclusion consistent. The allowed root itself may
 * legitimately be a dot-directory (an operator's explicit choice), so only
 * segments below the root are checked. Assumes `canonicalPath` is contained. */
export function containsDotfileSegment(canonicalPath: string, allowedDirs: string[]): boolean {
	const baseDir = allowedDirs.find(
		(dir) => canonicalPath === dir || canonicalPath.startsWith(dir + '/')
	);
	if (!baseDir) return false;
	const relative = canonicalPath.slice(baseDir.length).replace(/^\//, '');
	if (!relative) return false;
	return relative.split('/').some((segment) => segment.startsWith('.'));
}

/** Maps validateFilePath()'s error strings to HTTP status codes. */
export function filePathErrorStatus(error: string): number {
	switch (error) {
		case 'File access is not configured':
			return 403;
		case 'Path is required':
		case 'Path contains invalid characters':
		case 'Absolute path required':
			return 400;
		case 'Path not accessible':
			return 404;
		case 'Access denied':
			return 403;
		default:
			return 400;
	}
}
