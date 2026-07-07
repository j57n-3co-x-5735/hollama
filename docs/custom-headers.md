# Custom Headers

Operators can configure extra HTTP headers that the proxy sends to upstream API providers. This supports providers that require custom authentication headers, request routing, or tracing.

![Fireworks connection config showing custom headers and session affinity](screenshots/settings-fireworks.png)

## How it works

1. User enters headers in the ExtraHeaders UI component on the Settings → Connection page
2. On Verify, the browser POSTs the headers (along with the API key) to `/api/keys`
3. The server stores them in the credential store (`credentials.json`) after sanitization
4. On every `/api/chat` and `/api/models` request, the proxy applies the stored headers to the upstream `fetch()` call

Headers are stored in `ServerCredentials.extraHeaders` on the server — they are **not** on the client-side `Server` interface and do not appear in localStorage.

## Availability

ExtraHeaders is shown for **OpenAI** and **OpenAI-Compatible** connection types only (`{#if isOpenAiFamily}` in `Connection.svelte`). Ollama connections do not show the custom headers UI.

## Sanitization

`sanitizeHeaders()` in `src/lib/connections.ts` processes all user-supplied headers:

### Reserved header blocklist

These names are silently dropped (case-insensitive match after lowercasing):

```
authorization  content-type  host  connection
content-length  transfer-encoding  accept
```

The `authorization` block is critical — without it, a user-supplied `Authorization: Bearer <wrong-key>` would override the proxy's API key for every request.

### Processing rules

- Header names must match RFC 7230 token syntax: `/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/`
- Names are lowercased and whitespace-trimmed
- Control characters are stripped from values: NUL, SOH through BS, LF, VT, FF, SO through US, DEL (everything except HTAB)
- Empty keys, empty values, and values that become empty after stripping are dropped
- Always returns `{}` (never `undefined`)

### Defensive ordering

When the proxy builds upstream headers, custom headers are spread first, then `Authorization` is set last:

```typescript
const headers = {};
Object.assign(headers, sanitizedExtraHeaders);
headers['Authorization'] = `Bearer ${apiKey}`;  // always wins
```

This ensures the API key cannot be overridden even if a reserved header somehow survives sanitization.

## UI component

`src/routes/settings/ExtraHeaders.svelte`

- Key/value pairs rendered as input rows
- `oninput` events (not `onblur`) — values propagate immediately, no stale data on Verify
- `$effect` syncs entries from the `headers` prop when external state changes
- `MAX_ENTRIES = 20` — enforced on load (`.slice(0, MAX_ENTRIES)`) and in the UI (Add Header button hidden at cap)
- Case-insensitive deduplication in `emitChange()` — uses a `Map` keyed by lowercased header name, last value wins
- Sanitization runs on the emitted value before it reaches the parent

## CORS considerations

Since all API calls go through the server-side proxy, CORS is not a concern for custom headers — the proxy makes server-to-server requests where CORS doesn't apply.

In Electron, the `onHeadersReceived` interceptor handles CORS for any remaining browser-direct requests (e.g., Ollama connections on localhost).

For browser-only deployments (no Electron, no proxy — not the default in this fork), custom headers that trigger CORS preflight against servers without `Access-Control-Allow-Headers` will fail. The i18n string `customHeadersCorsWarning` documents this.

## Key files

| File | Role |
|---|---|
| `src/routes/settings/ExtraHeaders.svelte` | UI component — input rows, dedup, MAX_ENTRIES |
| `src/routes/settings/Connection.svelte` | Parent — submits headers to `/api/keys` on Verify |
| `src/lib/connections.ts` | `sanitizeHeaders()`, `RESERVED_HEADERS`, `VALID_HEADER_NAME` |
| `src/routes/api/keys/+server.ts` | Receives headers, stores via `setCredentials()` |
| `src/lib/server/credentials.ts` | `setCredentials()` calls `sanitizeHeaders()` before storing |
| `src/routes/api/chat/+server.ts` | Re-sanitizes and applies headers to upstream request |
| `src/lib/server/models-handler.ts` | Re-sanitizes and applies headers to upstream model listing |
| `tests/extra-headers.test.ts` | E2E tests — oninput, dedup, MAX_ENTRIES |
| `tests/security.test.ts` | Unit tests — sanitizeHeaders blocklist, control chars, edge cases |
