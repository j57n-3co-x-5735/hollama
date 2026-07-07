# Security

This doc covers the security mechanisms in the fork. For the privacy story (what was removed from upstream), see [Privacy Changes](privacy-changes.md).

## SSRF protection

`validateUpstreamUrl()` in `src/lib/server/credentials.ts` runs on every `/api/chat` and `/api/models` request before any upstream fetch. It blocks:

| Category | What's blocked |
|---|---|
| Loopback | `127.0.0.0/8`, `localhost`, `::1` |
| RFC 1918 | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Link-local | `169.254.0.0/16`, `fe80::/10` |
| Carrier-grade NAT | `100.64.0.0/10` |
| IPv6 ULA | `fc00::/7` |
| IPv4-mapped IPv6 | `::ffff:*` (blocked unconditionally — no legitimate use case for reaching IPv4 hosts via mapped addresses) |
| Cloud metadata | `169.254.169.254`, `metadata.google.internal`, `*.internal`, `*.local` |
| Special | `0.0.0.0`, userinfo in URL (`http://user:pass@host`), non-HTTP schemes |

Node's URL parser normalizes hex/octal/decimal IP forms (e.g., `0x7f000001` → `127.0.0.1`), so the check works against normalized dotted notation.

Tested in `tests/security.test.ts` — `validateUpstreamUrl` describe block (~20 tests).

## Header sanitization

`sanitizeHeaders()` in `src/lib/connections.ts` processes user-supplied custom headers at every trust boundary.

### Reserved header blocklist

These headers are silently dropped (case-insensitive):

```
authorization, content-type, host, connection,
content-length, transfer-encoding, accept
```

The `authorization` block prevents a user-supplied `Authorization` header from overriding the proxy's `Bearer` token. The proxy always sets `Authorization` last after spreading sanitized custom headers.

### Other sanitization

- Header names must match `/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/` (RFC 7230 token)
- Header names are lowercased and trimmed
- Control characters stripped from values: `/[\x00-\x08\x0A-\x1F\x7F]/g` (all C0 controls except HTAB)
- Empty keys, empty values, and values that become empty after stripping are dropped
- Returns `{}` (never `undefined`) when input is falsy or no valid headers remain

### Where sanitization runs

1. `setCredentials()` — when credentials are stored via `/api/keys`
2. `loadPersistedStore()` — when credentials are loaded from disk on startup
3. `/api/chat` and `/api/models` route handlers — before building upstream headers (defense-in-depth)

Tested in `tests/security.test.ts` — `sanitizeHeaders` describe block (~17 tests).

## Origin checking

`checkOrigin()` in `src/lib/server/validation.ts` validates that POST/DELETE requests to `/api/keys` come from the same origin. This prevents CSRF attacks from tricking the browser into submitting credentials to a malicious URL.

The check uses URL parsing (not string `endsWith`) to compare the `Origin` header's hostname+port against the `Host` header. This blocks suffix-matching bypasses like `evil.com-localhost:5173`.

- Missing `Origin` header: allowed (server-to-server calls)
- Missing `Host` header: allowed (route handler validates separately)
- Malformed `Host` (ambiguous colons outside IPv6 brackets): returns 400 (fail-closed)
- Parse failure on `Origin`: returns 403
- **Desktop mode:** bypassed when `PUBLIC_ADAPTER === 'electron-node'` (the user controls both ends; cross-origin protection is unnecessary)

Tested in `tests/security.test.ts` — `checkOrigin` describe block (~9 tests).

## CSP source validation

`isValidCspSource()` in `src/hooks.server.ts` validates operator-provided CSP sources from the `PUBLIC_CSP_CONNECT_SOURCES` env var before injecting them into the Content-Security-Policy header.

The primary attack vector is semicolon injection: a malicious source like `https://x.com; script-src *` would close the `connect-src` directive and inject a new permissive `script-src`. The validator blocks:

- Semicolons anywhere in the token
- Whitespace (spaces, tabs) — would split into multiple tokens
- Control characters
- `javascript:` scheme (matched by the general character class)
- Empty strings

Legitimate CSP tokens pass: URLs, `'self'`, `'unsafe-inline'`, `'nonce-*'`, `'sha256-*'`, scheme sources (`data:`, `blob:`), wildcards (`*.example.com`).

Tested in `tests/security.test.ts` — `isValidCspSource` describe block (~10 tests).

## Import validation

`sanitizeImportedServer()` in `src/lib/connections.ts` validates server records during JSON import. It:

- Rejects non-object input
- Validates `connectionType` against the `ConnectionType` enum
- Validates `id` (non-empty string)
- Validates `baseUrl` (parseable URL, non-empty)
- Strips userinfo (`user:pass@`) from `baseUrl`
- Forces `isVerified` to `null` and `isEnabled` to `false` (prevents pre-verified malicious URLs)
- Scopes `sessionAffinityKey` to `openai-compatible` only (drops it for other types)
- Type-checks `label` and `modelFilter` (string or dropped)

Tested in `tests/security.test.ts` — `sanitizeImportedServer` describe block (~15 tests).

## Credential isolation

- API keys and custom headers are stored server-side only (`credentials.json`, mode `0600`)
- `+layout.svelte` strips `apiKey` and `extraHeaders` from any server objects in localStorage on load (migration from older versions)
- The `x-api-key` per-request header mode does not cache keys in the store (prevents stale credentials on rotation)
- Environment-supplied keys (`OPENAI_API_KEY`) are never written to the credential file

## Electron hardening

- `webSecurity` is at its default `true` (not disabled)
- CORS bypass uses `session.defaultSession.webRequest.onHeadersReceived` to inject `Access-Control-Allow-*` headers only for non-localhost responses
- Server binds to `127.0.0.1` only (`HOST` env var) — not network-accessible
- `ORIGIN` is set explicitly to `http://127.0.0.1:{port}` to prevent adapter-node defaulting to `https` protocol
- `HOLLAMA_DATA_DIR` is set to `app.getPath('userData')/data` for reliable credential persistence
- SSRF validation (`validateUpstreamUrl`) and origin checking (`checkOrigin`) are bypassed in desktop mode (`PUBLIC_ADAPTER === 'electron-node'`) — the user controls both ends
- Environment variables are whitelisted before passing to the server process (see [Electron Deployment](electron-deployment.md) for the full list)
