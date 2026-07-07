# Architecture

## Proxy endpoints

All upstream API communication goes through SvelteKit server routes. The browser never contacts external APIs directly.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/keys` | POST | Submit API key + extraHeaders to server-side credential store |
| `/api/keys` | DELETE | Remove credentials for a baseUrl |
| `/api/models` | GET | Proxy model listing; Fireworks fallback if standard path fails |
| `/api/chat` | POST | Proxy chat completions; streams SSE back to browser |
| `/api/metadata` | GET | Server metadata (whether env-supplied API key exists) |

## Request flow

Every proxied request follows this path:

```
1. Browser sends request to /api/models or /api/chat
       ↓
2. Route handler extracts baseUrl from query/body
       ↓
3. validateUpstreamUrl(baseUrl) — SSRF check
   Blocks: loopback, RFC 1918, IPv6 ULA/link-local,
   IPv4-mapped IPv6, cloud metadata, .internal/.local
       ↓
4. resolveApiKey(baseUrl, envKey, headerKey) — credential resolution
   Priority: OPENAI_API_KEY env var > stored credentials > x-api-key header
       ↓
5. buildUpstreamHeaders(apiKey, extraHeaders)
   - sanitizeHeaders(extraHeaders) — strips RESERVED_HEADERS, control chars
   - Sets Authorization last (API key always wins)
       ↓
6. fetch() to upstream provider
       ↓
7. Response streamed back to browser (chat) or returned as JSON (models)
```

### Fireworks model listing fallback

`/api/models` has a two-tier fallback for Fireworks URLs (detected by `baseUrl.includes('fireworks.ai')`):

```
Standard /v1/models
    ↓ success → return upstream JSON
    ↓ 401 → "Invalid API key" (no fallback)
    ↓ 403 → "Access denied" (no fallback)
    ↓ network error or other HTTP error + Fireworks URL
        ↓
Proprietary /v1/accounts/fireworks/models
    - pageSize=200, pageToken iteration, 10-page safety cap
    - Response normalization: model.name → { id, object: 'model' }
    - Validates Array.isArray(data.models)
```

The orchestration lives in `src/lib/server/models-handler.ts`, with the proprietary fetcher in `src/lib/server/fireworks-models.ts`. Both accept an injectable `fetchFn` for testing. The route handler (`src/routes/api/models/+server.ts`) is a thin wrapper that resolves credentials and delegates.

## Credential store

`src/lib/server/credentials.ts`

### Storage

Credentials are stored in a `Map<string, ServerCredentials>` keyed by `baseUrl`. The map is persisted to disk as `.hollama/credentials.json` (configurable via `HOLLAMA_DATA_DIR` env var). File permissions are `0600`. Writes are atomic (temp file + rename).

```typescript
interface ServerCredentials {
    apiKey: string;
    extraHeaders?: Record<string, string>;
    fromHeader?: boolean;  // observability marker for header-supplied keys
}
```

### Resolution order

`resolveApiKey(baseUrl, envKey, headerKey)` resolves credentials in this priority:

1. **`OPENAI_API_KEY` env var** — highest priority; uses env key but merges stored `extraHeaders`
2. **Stored credentials** — from `/api/keys` POST, persisted to disk
3. **`x-api-key` request header** — per-request, ephemeral (not cached), merges stored `extraHeaders`
4. **None** — returns `undefined`, route handler returns 401

Header-supplied keys are intentionally not cached to avoid stale-credential hazards on key rotation.

### Sanitization boundaries

`sanitizeHeaders()` is called at multiple points:

- **Storage time** — `setCredentials()` sanitizes before writing to the map
- **Persistence load** — `loadPersistedStore()` re-sanitizes when reading from disk
- **Request time** — `/api/chat` and `/api/models` re-sanitize before building upstream headers (defense-in-depth)

## Content Security Policy

CSP directives are defined in `svelte.config.js`:

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `connect-src 'self' http://localhost:* http://127.0.0.1:*`
- `img-src 'self' data:`
- `font-src 'self'`
- `frame-src 'none'`
- `object-src 'none'`
- `base-uri 'self'`

The server hook (`src/hooks.server.ts`) extends `connect-src` at runtime with operator-configured sources from the `PUBLIC_CSP_CONNECT_SOURCES` env var. Each source token is validated by `isValidCspSource()` which blocks semicolon injection, whitespace, and control characters.

## Data model

### Browser (localStorage)

| Store | Contents |
|---|---|
| `hollama-servers` | Server metadata: id, baseUrl, connectionType, isVerified, isEnabled, label, modelFilter, sessionAffinityKey. **No API keys or extraHeaders.** |
| `hollama-sessions` | Chat sessions: messages, model, systemPromptText, reasoningEffort |
| `hollama-knowledge` | Knowledge entries |
| `hollama-settings` | UI preferences (theme, language, sidebar state) |

### Server (credentials.json)

| Field | Contents |
|---|---|
| `credentials` | Map of baseUrl → { apiKey, extraHeaders }. Persisted to `$HOLLAMA_DATA_DIR/credentials.json`. |

### Migration

On app load, `+layout.svelte` strips sensitive fields (`apiKey`, `extraHeaders`) from any server objects in localStorage (handles data from older versions).

## Import / export

`DataManagement.svelte` handles JSON import/export of all localStorage stores.

Server imports run through `sanitizeImportedServer()` which:
- Validates `connectionType` against the enum
- Validates `id` (non-empty string) and `baseUrl` (parseable URL)
- Strips userinfo from `baseUrl`
- Resets `isVerified` to `null` and `isEnabled` to `false` (forces re-verification)
- Scopes `sessionAffinityKey` to OpenAI-Compatible only

## Key source files

| File | Role |
|---|---|
| `src/routes/api/models/+server.ts` | Thin route wrapper — credential resolution, delegates to handler |
| `src/lib/server/models-handler.ts` | Model listing orchestration — standard path, Fireworks fallback |
| `src/lib/server/fireworks-models.ts` | Fireworks proprietary endpoint fetcher with pagination |
| `src/routes/api/chat/+server.ts` | Chat proxy — credential resolution, header sanitization, SSE passthrough |
| `src/routes/api/keys/+server.ts` | Credential management — POST (store), DELETE (remove), checkOrigin |
| `src/lib/server/credentials.ts` | Credential store — persistence, resolution, SSRF validation |
| `src/lib/connections.ts` | `sanitizeHeaders`, `sanitizeImportedServer`, `Server` interface |
| `src/hooks.server.ts` | CSP headers, `isValidCspSource` |
