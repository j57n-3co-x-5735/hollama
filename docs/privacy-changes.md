# Privacy Changes

Changes made to the upstream Hollama codebase for privacy hardening.

## Removals

### Plausible analytics
Removed the Plausible script tag from `app.html`. No telemetry of any kind is sent.

### GitHub update checking
Removed `src/lib/updates.ts` and the version check UI that fetched GitHub releases on page load. The Version component now shows the local version only — no outbound requests.

### Cloudflare adapter
Replaced `@sveltejs/adapter-cloudflare` with `@sveltejs/adapter-node`. The app runs as a Node.js process, not a Cloudflare Worker. This enables server-side credential storage and the proxy architecture.

### OpenAI SDK
Removed the `openai` npm package. All OpenAI-compatible API calls go through the server-side proxy using `fetch()`. This eliminates `dangerouslyAllowBrowser: true` and keeps API keys server-side.

## Additions

### Server-side proxy
Three new API routes handle all upstream communication:

- `/api/chat` — proxies chat completions, streams SSE back to browser
- `/api/models` — proxies model listing with Fireworks fallback
- `/api/keys` — receives credentials from the browser, stores server-side

The browser never contacts external APIs. See [Architecture](architecture.md) for details.

### Credential isolation
API keys and custom headers are stored in a server-side `Map` persisted to `.hollama/credentials.json` (mode `0600`). On app load, `+layout.svelte` strips any `apiKey` or `extraHeaders` that may exist in localStorage server objects (migration from the pre-proxy architecture).

Credential resolution follows a three-tier priority: `OPENAI_API_KEY` env var > stored credentials > per-request `x-api-key` header. See [Architecture — Credential store](architecture.md#credential-store).

### SSRF protection
`validateUpstreamUrl()` blocks the proxy from reaching private IPs, cloud metadata endpoints, loopback, IPv4-mapped IPv6, and non-HTTP schemes. See [Security — SSRF protection](security.md#ssrf-protection).

### Content Security Policy
`src/hooks.server.ts` sets CSP headers on all responses. `connect-src` is locked to `'self'` plus operator-configured sources (validated by `isValidCspSource()`). See [Security — CSP source validation](security.md#csp-source-validation).

### Header sanitization
`sanitizeHeaders()` strips reserved header names (`authorization`, `content-type`, `host`, etc.) and control characters from user-supplied custom headers. Applied at storage, load, and request time. See [Security — Header sanitization](security.md#header-sanitization).

### Import validation
`sanitizeImportedServer()` validates every field of imported server records — checks enum values, strips userinfo from URLs, forces `isVerified` to null and `isEnabled` to false. See [Security — Import validation](security.md#import-validation).

### Origin checking
`checkOrigin()` on `/api/keys` prevents CSRF attacks by comparing `Origin` and `Host` headers using URL parsing (not string matching). See [Security — Origin checking](security.md#origin-checking).

### Credential migration on load
`+layout.svelte` detects server objects in localStorage that contain `apiKey` or `extraHeaders` (from older versions or the pre-proxy architecture). It strips those fields and saves the cleaned objects back to localStorage, then submits the credentials to `/api/keys` so they're stored server-side.

### Network activity panel
`src/routes/settings/NetworkActivity.svelte` shows a log of all proxy requests made by the current browser session — URL, method, status, source label. Backed by `src/lib/networkLog.ts`.

### Electron environment filtering
`electron/main.js` whitelists environment variables before passing them to the server process:

```
PORT, PUBLIC_ADAPTER, OPENAI_API_KEY, PUBLIC_CSP_CONNECT_SOURCES,
NODE_ENV, HOME, PATH, HTTP_PROXY, HTTPS_PROXY, NO_PROXY,
NODE_EXTRA_CA_CERTS, NODE_TLS_REJECT_UNAUTHORIZED
```

All other env vars from the parent process are dropped.

### Theme initialization without FOUC
`static/theme-init.js` reads the theme from localStorage and applies it before Svelte hydrates, preventing a flash of unstyled content.
