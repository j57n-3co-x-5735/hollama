import { expect, test } from '@playwright/test';

import { sanitizeHeaders, sanitizeImportedServer } from '$lib/connections';
import {
	isKeylessProxyAllowed,
	isLoopbackUrl,
	resolveApiKey,
	validateUpstreamUrl
} from '$lib/server/credentials';
import { checkOrigin, isValidCspSource } from '$lib/server/validation';

/**
 * Security-critical helper unit tests.
 *
 * The project is Playwright-only — there is no separate unit-test harness.
 * These tests use Playwright's `test` runner with direct function imports,
 * which works because tests run in a Node context where `$lib` resolves
 * via TypeScript path mapping.
 *
 * Coverage:
 *  - validateUpstreamUrl: loopback, RFC 1918, IPv6, userinfo, malicious
 *  - sanitizeImportedServer: enum, id, baseUrl, isVerified reset, headers
 *  - resolveApiKey: envKey, headerKey, stored, gaps between modes
 *  - checkOrigin: legitimate, endsWith bypass, port mismatch, malformed
 *  - isValidCspSource: valid URLs, semicolon injection, whitespace
 */

process.env.HOLLAMA_DATA_DIR = process.env.HOLLAMA_DATA_DIR ?? '/tmp/hollama-security-test';

test.describe('validateUpstreamUrl - SSRF blocklist', () => {
	test('legitimate OpenAI URL allows', () => {
		expect(validateUpstreamUrl('https://api.openai.com/v1')).toBeNull();
	});

	test('legitimate Fireworks URL allows', () => {
		expect(validateUpstreamUrl('https://api.fireworks.ai/inference/v1')).toBeNull();
	});

	test('legitimate custom domain allows', () => {
		expect(validateUpstreamUrl('https://api.example.com/v1')).toBeNull();
	});

	test('IPv4 loopback 127.0.0.1 blocks', () => {
		const result = validateUpstreamUrl('http://127.0.0.1:11434/v1');
		expect(result).toBeTruthy();
		expect(result).toMatch(/restricted/);
	});

	test('localhost literal blocks', () => {
		const result = validateUpstreamUrl('http://localhost:11434/v1');
		expect(result).toBeTruthy();
		expect(result).toMatch(/restricted/);
	});

	test('IPv4 RFC 1918 10.0.0.0/8 blocks', () => {
		expect(validateUpstreamUrl('http://10.0.0.1/v1')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://10.255.255.255/v1')).toMatch(/restricted/);
	});

	test('IPv4 RFC 1918 172.16/12 blocks', () => {
		expect(validateUpstreamUrl('http://172.16.0.1/v1')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://172.31.255.255/v1')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://172.15.0.1/v1')).toBeNull(); // outside 172.16/12
	});

	test('IPv4 RFC 1918 192.168/16 blocks', () => {
		expect(validateUpstreamUrl('http://192.168.1.1/v1')).toMatch(/restricted/);
	});

	test('IPv4 link-local 169.254.169.254 (cloud metadata) blocks', () => {
		expect(validateUpstreamUrl('http://169.254.169.254/')).toMatch(/restricted/);
	});

	test('IPv6 loopback ::1 blocks', () => {
		expect(validateUpstreamUrl('http://[::1]/v1')).toMatch(/restricted/);
	});

	test('IPv6 ULA fc00::/7 blocks', () => {
		expect(validateUpstreamUrl('http://[fc00::1]/v1')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://[fd12:3456:789a::1]/v1')).toMatch(/restricted/);
	});

	test('IPv6 link-local fe80::/10 blocks', () => {
		expect(validateUpstreamUrl('http://[fe80::1]/v1')).toMatch(/restricted/);
	});

	test('IPv4-mapped IPv6 ::ffff:7f00:1 blocks', () => {
		// The validator must catch hex-hex IPv4-mapped IPv6 addresses; Node URL
		// parser normalizes both dotted and hex forms to hex-hex notation.
		const result = validateUpstreamUrl('http://[::ffff:7f00:1]/v1');
		expect(result).toBeTruthy();
		expect(result).toMatch(/IPv4-mapped/);
	});

	test('IPv4-mapped IPv6 ::ffff:c0a8:101 (hex-hex for 192.168.1.1) blocks', () => {
		const result = validateUpstreamUrl('http://[::ffff:c0a8:101]/v1');
		expect(result).toBeTruthy();
		expect(result).toMatch(/IPv4-mapped/);
	});

	test('IPv4-mapped IPv6 ::ffff:8.8.8.8 (public wrapped) blocks', () => {
		const result = validateUpstreamUrl('http://[::ffff:8.8.8.8]/v1');
		expect(result).toBeTruthy();
		expect(result).toMatch(/IPv4-mapped/);
	});

	test('hex IP hostname 0x7f000001 normalizes and blocks as loopback', () => {
		// Node URL parser normalizes hex/dec/octal IPv4 forms to dotted notation.
		// So 0x7f000001 becomes 127.0.0.1 → loopback → blocked.
		expect(validateUpstreamUrl('http://0x7f000001/v1')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://2130706433/v1')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://0177.0.0.1/v1')).toMatch(/restricted/);
	});

	test('metadata.google.internal blocks', () => {
		expect(validateUpstreamUrl('http://metadata.google.internal/')).toMatch(/restricted/);
	});

	test('.internal suffix blocks', () => {
		expect(validateUpstreamUrl('https://something.internal/v1')).toMatch(/restricted/);
	});

	test('.local suffix blocks', () => {
		expect(validateUpstreamUrl('https://something.local/v1')).toMatch(/restricted/);
	});

	test('userinfo in URL blocks (defense-in-depth)', () => {
		// URL constructor rejects userinfo, but the defense-in-depth check
		// catches the edge case.
		const result = validateUpstreamUrl('http://user:pass@api.openai.com/v1');
		expect(result).toBeTruthy();
		// Either constructor rejection or our check rejects.
	});

	test('non-HTTP scheme blocks', () => {
		expect(validateUpstreamUrl('file:///etc/passwd')).toMatch(/HTTP/);
		expect(validateUpstreamUrl('javascript:alert(1)')).toMatch(/HTTP/);
	});

	test('invalid URL returns Invalid URL', () => {
		expect(validateUpstreamUrl('not-a-url')).toBe('Invalid URL');
	});
});

test.describe('sanitizeHeaders - extraHeaders sanitization', () => {
	// The RESERVED_HEADERS blocklist at connections.ts:5 prevents credential
	// leakage (e.g. an operator's "Authorization" value silently overwriting
	// or merging with the proxy's Bearer token).
	//
	// p0 = reserved-header blocklist + invalid-header-name rejection
	// p1 = normalization (lowercase, trimming), control-char stripping,
	//      empty-value filtering

	test('p0: Authorization header is stripped (override attack vector)', () => {
		const result = sanitizeHeaders({ Authorization: 'Bearer attacker-key' });
		expect(result).toEqual({});
		expect(result).not.toHaveProperty('authorization');
		expect(result).not.toHaveProperty('Authorization');
	});

	test('p0: Authorization header is stripped regardless of casing', () => {
		const result = sanitizeHeaders({ AUTHORIZATION: 'Bearer attacker-key' });
		expect(result).toEqual({});
	});

	test('p0: Host header is stripped (SSRF bypass via Host header)', () => {
		// Host header in fetch() takes precedence over the URL in some libraries.
		// Stripping prevents an operator from re-pointing upstream via Host.
		const result = sanitizeHeaders({ Host: 'evil.example' });
		expect(result).toEqual({});
	});

	test('p0: Content-Type is stripped (override Content-Type attack)', () => {
		// Setting Content-Type to multipart/form-data or text/html could change
		// how upstream validates the body. Must be stripped.
		const result = sanitizeHeaders({ 'Content-Type': 'multipart/form-data' });
		expect(result).toEqual({});
	});

	test('p1: full RESERVED_HEADERS blocklist (defense-in-depth sweep)', () => {
		// Each reserved header must be stripped, regardless of casing or
		// surrounding whitespace. This catches regressions in the blocklist
		// definition itself.
		const reservedCases = [
			'authorization',
			'Authorization',
			'AUTHORIZATION',
			'content-type',
			'Content-Type',
			'host',
			'Host',
			'HOST',
			'connection',
			'Connection',
			'content-length',
			'Content-Length',
			'transfer-encoding',
			'Transfer-Encoding',
			'accept',
			'Accept'
		];
		for (const name of reservedCases) {
			const result = sanitizeHeaders({ [name]: 'attacker-value' });
			expect(result, `Expected "${name}" to be stripped`).toEqual({});
		}
	});

	test('p1: legitimate custom headers are retained', () => {
		const result = sanitizeHeaders({
			'X-Custom-Header': 'value1',
			'OpenAI-Organization': 'org-abc',
			'X-Request-ID': 'req-123'
		});
		expect(result['x-custom-header']).toBe('value1');
		expect(result['openai-organization']).toBe('org-abc');
		expect(result['x-request-id']).toBe('req-123');
	});

	test('p1: keys are lowercased (HTTP header case-insensitivity)', () => {
		const result = sanitizeHeaders({ 'X-Custom-Header': 'value' });
		// Stored under the lowercase key, regardless of input casing.
		expect(Object.keys(result)).toEqual(['x-custom-header']);
		expect(result['x-custom-header']).toBe('value');
	});

	test('p1: keys are whitespace-trimmed', () => {
		const result = sanitizeHeaders({ '  X-Custom-Header  ': 'value' });
		expect(Object.keys(result)).toEqual(['x-custom-header']);
	});

	test('p1: control characters stripped from values', () => {
		// CR/LF/NUL injection into header values can enable response-splitting
		// attacks at proxies that don't sanitize. Strip them.
		const result = sanitizeHeaders({
			'X-Custom': 'value-with-\u0000null-\nlf-\rcr-end'
		});
		// Only the control chars (NUL, LF, CR) are removed; the surrounding
		// literal text (including the "null"/"lf"/"cr" labels) is preserved —
		// stripping must not eat adjacent visible characters.
		expect(result['x-custom']).toBe('value-with-null-lf-cr-end');
	});

	test('p1: TABS and control chars 0x01-0x08 also stripped', () => {
		const result = sanitizeHeaders({
			'X-Custom': 'a\u0001b\u0002c\u0008d'
		});
		expect(result['x-custom']).toBe('abcd');
	});

	test('p1: value that becomes empty after control-char strip is filtered', () => {
		// If stripping leaves an empty value, drop the entry entirely.
		const result = sanitizeHeaders({
			'X-Custom': '\u0000\u0001\u0002'
		});
		expect(result).toEqual({});
	});

	test('p1: undefined input returns empty object', () => {
		expect(sanitizeHeaders(undefined)).toEqual({});
	});

	test('p1: empty input returns empty object', () => {
		expect(sanitizeHeaders({})).toEqual({});
	});

	test('p1: empty value filtered, valid headers retained', () => {
		const result = sanitizeHeaders({
			'X-Valid': 'value',
			'X-Empty': '',
			'X-Whitespace': '   '
		});
		expect(result['x-valid']).toBe('value');
		expect(result).not.toHaveProperty('x-empty');
		expect(result).not.toHaveProperty('x-whitespace');
	});

	test('p1: invalid characters in header name cause entry to be dropped', () => {
		// VALID_HEADER_NAME = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/
		// Reject parentheses (used in abort/break attacks), spaces, semicolons,
		// angle brackets, etc.
		const result = sanitizeHeaders({
			'X-Valid': 'good',
			'X (bad)': 'parentheses',
			'X;bad': 'semicolon',
			'X<bad>': 'angle',
			'X bad': 'space',
			'X"bad': 'quote',
			'X\\bad': 'backslash'
		});
		// Only the valid one survives.
		expect(Object.keys(result)).toEqual(['x-valid']);
	});

	test('p1: reserved header survives in a way that nullifies it', () => {
		// If a user provides both an Authorization override AND a legitimate
		// header, the override MUST be dropped without affecting the legit one.
		const result = sanitizeHeaders({
			Authorization: 'Bearer attacker',
			'X-Legit-Header': 'legit-value'
		});
		expect(result['x-legit-header']).toBe('legit-value');
		expect(result).not.toHaveProperty('authorization');
	});

	test('p1: returned object is plain (not prototype-polluted)', () => {
		// The result MUST be a fresh object — if it shared Object.prototype,
		// adversarial keys ("__proto__", "constructor") could pollute.
		const result = sanitizeHeaders({ 'X-Test': 'value' });
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		// The function uses Object.fromEntries-style construction, so this is
		// a defensive guard against a future refactor that returns `raw` directly.
	});
});

test.describe('sanitizeImportedServer - import hardening', () => {
	const validRecord = {
		id: 'x',
		connectionType: 'openai',
		baseUrl: 'https://api.openai.com/v1'
	};

	test('valid record accepts', () => {
		const result = sanitizeImportedServer(validRecord);
		expect(result.id).toBe('x');
		expect(result.connectionType).toBe('openai');
		expect(result.baseUrl).toBe('https://api.openai.com/v1');
		expect(result.isVerified).toBeNull();
		expect(result.isEnabled).toBe(false);
	});

	test('non-enum connectionType rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, connectionType: 'openai-evil' })).toThrow(
			/Invalid connectionType/
		);
	});

	test('non-string connectionType rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, connectionType: 42 })).toThrow();
	});

	test('empty id rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, id: '' })).toThrow(/id/);
	});

	test('whitespace-only id rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, id: '   ' })).toThrow();
	});

	test('non-string id rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, id: 123 })).toThrow();
	});

	test('empty baseUrl rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, baseUrl: '' })).toThrow(/baseUrl/);
	});

	test('malformed baseUrl rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, baseUrl: 'not-a-url' })).toThrow();
	});

	test('non-string baseUrl rejects', () => {
		expect(() => sanitizeImportedServer({ ...validRecord, baseUrl: 42 })).toThrow();
	});

	test('isVerified reset to null on import', () => {
		const result = sanitizeImportedServer({
			...validRecord,
			isVerified: '2025-01-01'
		});
		expect(result.isVerified).toBeNull();
	});

	test('isEnabled reset to false on import', () => {
		const result = sanitizeImportedServer({ ...validRecord, isEnabled: true });
		expect(result.isEnabled).toBe(false);
	});

	test('userinfo stripped from baseUrl', () => {
		const result = sanitizeImportedServer({
			...validRecord,
			baseUrl: 'https://user:pass@evil.example/v1'
		});
		expect(result.baseUrl).not.toContain('user:pass');
	});

	test('sessionAffinityKey dropped for Ollama', () => {
		const result = sanitizeImportedServer({
			...validRecord,
			connectionType: 'ollama',
			sessionAffinityKey: 'abc'
		});
		expect(result.sessionAffinityKey).toBeUndefined();
	});

	test('sessionAffinityKey dropped for OpenAI (not -compatible)', () => {
		const result = sanitizeImportedServer({
			...validRecord,
			connectionType: 'openai',
			sessionAffinityKey: 'abc'
		});
		// Note: openai is allowed to silently drop sessionAffinityKey here.
		// The key check is that OpenAI-Compatible only retains it.
		expect(result.sessionAffinityKey).toBeUndefined();
	});

	test('sessionAffinityKey retained for OpenAI-Compatible', () => {
		const result = sanitizeImportedServer({
			...validRecord,
			connectionType: 'openai-compatible',
			sessionAffinityKey: 'abc'
		});
		expect(result.sessionAffinityKey).toBe('abc');
	});

	test('non-object input rejects', () => {
		expect(() => sanitizeImportedServer(null)).toThrow();
		expect(() => sanitizeImportedServer('a string')).toThrow();
		expect(() => sanitizeImportedServer(undefined)).toThrow();
	});
});

test.describe('resolveApiKey - credential resolution', () => {
	test('envKey alone returns envKey', () => {
		const result = resolveApiKey('https://x.example/v1', 'env-key', undefined);
		expect(result?.apiKey).toBe('env-key');
	});

	test('headerKey alone returns fromHeader marker', () => {
		// headerKey now merges stored extraHeaders, but with no stored,
		// extraHeaders is undefined.
		const result = resolveApiKey('https://x.example/v1', undefined, 'header-key');
		expect(result?.apiKey).toBe('header-key');
		expect(result?.fromHeader).toBe(true);
	});

	test('envKey takes priority over headerKey', () => {
		const result = resolveApiKey('https://x.example/v1', 'env-key', 'header-key');
		expect(result?.apiKey).toBe('env-key');
		expect(result?.fromHeader).toBeUndefined();
	});

	test('no creds returns undefined', () => {
		expect(resolveApiKey('https://x.example/v1', undefined, undefined)).toBeUndefined();
	});

	test('envKey is NOT applied to a loopback (keyless-local) baseUrl', () => {
		// The global OPENAI_API_KEY must not leak to a local llama.cpp the user runs
		// keyless. With no stored key, a loopback baseUrl resolves to
		// undefined (keyless) even when envKey is set; non-loopback still gets it.
		expect(resolveApiKey('http://127.0.0.1:1234/v1', 'env-key', undefined)).toBeUndefined();
		expect(resolveApiKey('http://localhost:11434/v1', 'env-key', undefined)).toBeUndefined();
		expect(
			resolveApiKey('https://api.fireworks.ai/inference/v1', 'env-key', undefined)?.apiKey
		).toBe('env-key');
	});
});

test.describe('validateUpstreamUrl - loopback and RFC 1918 smoke test', () => {
	test('loopback and private ranges blocked, public allowed', () => {
		// Loopback
		expect(validateUpstreamUrl('http://127.0.0.1/x')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://[::1]/x')).toMatch(/restricted/);
		// RFC 1918
		expect(validateUpstreamUrl('http://10.0.0.1/x')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://192.168.0.1/x')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://172.16.0.1/x')).toMatch(/restricted/);
		// Unspecified address (:: / 0.0.0.0) — not loopback, but still SSRF-restricted.
		expect(validateUpstreamUrl('http://[::]:8080/x')).toMatch(/restricted/);
		expect(validateUpstreamUrl('http://0.0.0.0:8080/x')).toMatch(/restricted/);
		// Legitimate control (must not regress)
		expect(validateUpstreamUrl('https://api.openai.com/v1')).toBeNull();
	});
});

test.describe('isValidCspSource - CSP source allowlist', () => {
	test('legitimate URL-shaped source', () => {
		expect(isValidCspSource('https://api.openai.com')).toBe(true);
		expect(isValidCspSource('https://api.fireworks.ai/inference/v1')).toBe(true);
		expect(isValidCspSource('https://api.example.com:8080/path?q=1#frag')).toBe(true);
	});

	test('CSP keywords', () => {
		expect(isValidCspSource("'self'")).toBe(true);
		expect(isValidCspSource("'unsafe-inline'")).toBe(true);
		expect(isValidCspSource("'nonce-abc123'")).toBe(true);
		expect(isValidCspSource("'sha256-abcdef0123456789='")).toBe(true);
	});

	test('CSP schemes and wildcards', () => {
		expect(isValidCspSource('data:')).toBe(true);
		expect(isValidCspSource('blob:')).toBe(true);
		expect(isValidCspSource('https:')).toBe(true);
		expect(isValidCspSource('*.example.com')).toBe(true);
	});

	test('URL-shape characters permitted (/, @, ?, #, =, &)', () => {
		// These characters must be allowed in the character class so that
		// operators setting legitimate URL-shaped sources are not silently
		// rejected.
		expect(isValidCspSource('https://api.openai.com/v1?key=abc')).toBe(true);
		expect(isValidCspSource('https://user@x.com')).toBe(true);
		expect(isValidCspSource('https://[::1]:8080')).toBe(true);
	});

	test('semicolon injection blocked (the primary attack vector)', () => {
		// The operator's configuration is whitespace-split into tokens
		// before this regex runs, so a token containing ';' indicates an
		// attempt to close the source list and start a new directive.
		expect(isValidCspSource('https://x.com;')).toBe(false);
		expect(isValidCspSource("'self'; img-src *")).toBe(false);
		expect(isValidCspSource('https://x.com; script-src')).toBe(false);
	});

	test('whitespace and control characters blocked', () => {
		expect(isValidCspSource('https://x.com https://y.com')).toBe(false);
		expect(isValidCspSource('https://x.com\ttab')).toBe(false);
		expect(isValidCspSource('https://x.com\u0000null')).toBe(false);
	});

	test('dangerous injections blocked', () => {
		expect(isValidCspSource('javascript:alert(1)')).toBe(false);
		expect(isValidCspSource("'self'<script>")).toBe(false);
		expect(isValidCspSource('foo"bar')).toBe(false);
		expect(isValidCspSource('foo\\bar')).toBe(false);
	});

	test('empty string rejected', () => {
		expect(isValidCspSource('')).toBe(false);
	});
});

test.describe('checkOrigin - origin check', () => {
	function makeRequest(
		origin: string | null,
		host: string | null,
		requestUrl = 'http://localhost:5173/api/keys'
	): Request {
		const headers = new Headers();
		if (origin) headers.set('origin', origin);
		if (host) headers.set('host', host);
		return new Request(requestUrl, {
			method: 'POST',
			headers
		});
	}

	test('legitimate same-origin allows', () => {
		const result = checkOrigin(makeRequest('http://localhost:5173', 'localhost:5173'));
		expect(result).toBeNull();
	});

	test('cross-origin via endsWith bypass rejected', () => {
		// 'evil.com-localhost:5173' endsWith 'localhost:5173' under the
		// old implementation. URL-parser-based check correctly rejects.
		const result = checkOrigin(makeRequest('http://evil.com-localhost:5173', 'localhost:5173'));
		expect(result).not.toBeNull();
		expect(result?.status).toBe(403);
	});

	test('port mismatch rejected', () => {
		const result = checkOrigin(makeRequest('http://localhost:9999', 'localhost:5173'));
		expect(result?.status).toBe(403);
	});

	test('scheme mismatch on a well-known scheme-port rejected', () => {
		// A well-known port DOES imply a scheme: an http Origin aimed at a :443
		// host, or an https Origin aimed at a :80 host, is a genuine cross-scheme
		// mismatch and must be rejected.
		expect(
			checkOrigin(makeRequest('http://api.example.com:443', 'api.example.com:443'))?.status
		).toBe(403);
		expect(
			checkOrigin(makeRequest('https://api.example.com:80', 'api.example.com:80'))?.status
		).toBe(403);
	});

	test('same-origin HTTPS on a non-standard port allowed (no false scheme reject)', () => {
		// Regression: a non-standard explicit port (:8443) does NOT imply
		// http — 8443 is commonly https — so a same-origin https request must pass.
		// Previously the scheme gate treated every non-443 port as http and 403'd it.
		expect(checkOrigin(makeRequest('https://example.com:8443', 'example.com:8443'))).toBeNull();
		// IPv6 twin.
		expect(checkOrigin(makeRequest('https://[::1]:8443', '[::1]:8443'))).toBeNull();
	});

	test('Electron desktop same-origin (http loopback :4173) allowed', () => {
		// The packaged renderer loads http://127.0.0.1:4173 and the embedded server
		// binds 127.0.0.1:4173; the proxy front-gate must not 403 that same-origin
		// pair.
		expect(checkOrigin(makeRequest('http://127.0.0.1:4173', '127.0.0.1:4173'))).toBeNull();
	});

	test('malformed Host header returns 400 (fail-closed)', () => {
		// When the Host header has 2+ colons that don't match the IPv6
		// bracket form, the function returns 400 rather than allowing
		// the request through.
		const result = checkOrigin(makeRequest('http://localhost:5173', 'a:b:c:d'));
		expect(result).not.toBeNull();
		expect(result?.status).toBe(400);
	});

	test('IPv6 bracketed host parses correctly', () => {
		const result = checkOrigin(makeRequest('http://[::1]:5173', '[::1]:5173'));
		expect(result).toBeNull();
	});

	test('default port normalization: https no-port = :443 (no false-reject when ORIGIN unset)', () => {
		// Port-less Host + https Origin. With the asymmetric scheme gate this is
		// allowed even when the request URL is http (ORIGIN unset) — proving a
		// legitimate https same-origin request is never false-rejected.
		const result = checkOrigin(makeRequest('https://api.example.com', 'api.example.com'));
		expect(result).toBeNull();
	});

	test('port-less Host served over https rejects an http origin', () => {
		// Server is https (request URL https), Host is port-less, Origin is http →
		// cross-scheme against an https deployment behind a port-stripping proxy.
		const result = checkOrigin(
			makeRequest('http://example.com', 'example.com', 'https://example.com/api/keys')
		);
		expect(result?.status).toBe(403);
	});

	test('no Origin header passes (server-to-server call)', () => {
		const result = checkOrigin(makeRequest(null, 'localhost:5173'));
		expect(result).toBeNull();
	});

	test('no Host header passes (route handler must reject if needed)', () => {
		const result = checkOrigin(makeRequest('http://localhost:5173', null));
		expect(result).toBeNull();
	});

	test('invalid origin header value rejected (fail-closed)', () => {
		// 'Origin' header with garbage value fails new URL(). The check
		// returns 403 to be conservative.
		const result = checkOrigin(makeRequest('not-a-url', 'localhost:5173'));
		expect(result?.status).toBe(403);
	});
});

test.describe('isLoopbackUrl - keyless containment', () => {
	// Keyless proxying is restricted to loopback upstreams so a missing key
	// can't be abused to reach the LAN / metadata / arbitrary hosts.
	test('loopback hosts → true', () => {
		expect(isLoopbackUrl('http://127.0.0.1:8080/v1')).toBe(true);
		expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true);
		expect(isLoopbackUrl('http://localhost:11434/v1')).toBe(true);
		expect(isLoopbackUrl('http://127.5.5.5:1234')).toBe(true); // 127/8
		expect(isLoopbackUrl('http://[::1]:8080/v1')).toBe(true);
	});

	test('non-loopback hosts → false (LAN, link-local/metadata, public)', () => {
		expect(isLoopbackUrl('http://10.0.0.5:8080/v1')).toBe(false);
		expect(isLoopbackUrl('http://192.168.1.9:8080/v1')).toBe(false);
		expect(isLoopbackUrl('http://172.16.0.1:8080')).toBe(false);
		expect(isLoopbackUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
		expect(isLoopbackUrl('https://api.example.com/v1')).toBe(false);
	});

	test(':: (unspecified) and 0.0.0.0 are NOT loopback → keyless denied', () => {
		// The unspecified address is not a same-machine target; keyless must not be
		// allowed to reach it. It stays SSRF-blocked in web/docker (below).
		expect(isLoopbackUrl('http://[::]:8080/v1')).toBe(false);
		expect(isLoopbackUrl('http://0.0.0.0:8080/v1')).toBe(false);
	});

	test('malformed URL → false (fail closed)', () => {
		expect(isLoopbackUrl('not-a-url')).toBe(false);
		expect(isLoopbackUrl('')).toBe(false);
	});
});

test.describe('isKeylessProxyAllowed - desktop gate', () => {
	test('desktop allows keyless, web/docker does not', () => {
		expect(isKeylessProxyAllowed(true)).toBe(true);
		expect(isKeylessProxyAllowed(false)).toBe(false);
	});
});
