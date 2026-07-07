# Privacy Architecture

This is a privacy-hardened fork of hollama. This document describes what network calls the app makes, where data is stored, and how to verify these claims.

## Network Requests

With default settings, hollama makes **zero unsolicited outbound network requests**.

| Request | Target | When | Data Sent |
|---------|--------|------|-----------|
| Ollama chat | User-configured localhost | User sends message | Conversation messages |
| Ollama tags | User-configured localhost | Server verify/model refresh | Nothing (GET) |
| Ollama pull | User-configured localhost | User pulls model | Model name |
| Proxy chat | `/api/chat` (local) | User sends message via OpenAI/Compatible | Model, messages, session affinity key |
| Proxy models | `/api/models` (local) | Server verify | Base URL |
| Proxy keys | `/api/keys` (local) | User submits credentials | API key, custom headers |
| Metadata | `/api/metadata` (local) | Version display | Nothing (GET) |

The server-side proxy forwards requests to the user-configured upstream API (e.g., api.openai.com, Fireworks). The browser never contacts external API servers directly.

## Data Storage

All user data is stored in browser localStorage:

| Key | Contents | Sensitive? |
|-----|----------|-----------|
| `hollama-settings` | Theme, language, sidebar state | No |
| `hollama-servers` | Server URLs, connection types, labels, model filters, session affinity keys | Low — no credentials |
| `hollama-sessions` | Full conversation history | Yes — user content |
| `hollama-knowledge` | Knowledge base entries | Medium — user content |

API keys and custom headers submitted via `/api/keys` are stored on the **server** in a credential map that is persisted to disk as **`.hollama/credentials.json`** (path configurable via `HOLLAMA_DATA_DIR`, file mode `0600`, atomic write via temp+rename). They are never written to localStorage, never included in data exports, and never returned to the browser after the initial POST. Header-supplied per-request credentials (via `x-api-key`) are not persisted at all.

To clear persisted server-side keys, delete `HOLLAMA_DATA_DIR/credentials.json` and restart the server, or call `DELETE /api/keys`.

## Content Security Policy

The app sets a strict CSP header via SvelteKit's built-in `kit.csp` (which auto-generates nonces for SvelteKit's own inline scripts):

- `script-src 'self' 'nonce-<auto>'` — only scripts from the app's own origin or with a valid nonce can execute. Blocks injected inline scripts. Blocks XSS from model-generated content rendered via markdown.
- `connect-src 'self' http://localhost:* http://127.0.0.1:*` — the browser can only connect to the local server and localhost (for Ollama). All external API calls go through the server-side proxy.
- `img-src 'self' data:` — images from same-origin and data URIs only.
- `frame-src 'none'` — no iframes.

To allow connections to a remote Ollama server, set the `PUBLIC_CSP_CONNECT_SOURCES` environment variable (e.g., `PUBLIC_CSP_CONNECT_SOURCES="https://ollama.example.com"`).

## API Key Handling

**Environment variable mode (recommended):** Set `OPENAI_API_KEY` in the server environment. The key never reaches the browser. The proxy uses it for all OpenAI/Compatible requests.

**Browser-entry mode:** Enter the API key in Settings. It is sent once to the server via `/api/keys` and persisted to `.hollama/credentials.json` so it survives server restart (atomic write, file mode `0600`). The browser does not persist it. The credentials file lives under the directory set in `HOLLAMA_DATA_DIR` (defaults to `.hollama/` relative to the server working directory).

**Header-supplied mode:** Per-request keys sent via the `x-api-key` header are not persisted and not cached — they are used for the duration of that single request only.

## Deployment Modes

**Docker (self-hosted):** Zero external connections by default. API calls go through the local proxy. Recommended for privacy.

**Electron (desktop):** Same privacy model. `webSecurity` is the default `true`; Ollama CORS bypass is achieved via a `webRequest.onHeadersReceived` interceptor that injects `Access-Control-Allow-*` only for non-localhost responses (localhost is exempted — already same-origin). Environment variables are filtered to a whitelist (`PORT`, `PUBLIC_ADAPTER`, `HOME`, `PATH`, `OPENAI_API_KEY`, `PUBLIC_CSP_CONNECT_SOURCES`, `NODE_ENV`) before passing to the SvelteKit server process.

**Upstream demo site:** The upstream project (hollama.fernando.is) runs on Cloudflare Pages with its own infrastructure logging. This fork does not deploy to Cloudflare — the adapter has been removed.

## What Was Removed

This fork removes the following from the upstream hollama codebase:

- **Plausible analytics** — conditional script injection that loaded third-party analytics. The setup supported anti-adblocker proxying via first-party routing.
- **GitHub update checking** — phone-home to api.github.com that leaked IP/User-Agent to Microsoft.
- **Cloudflare adapter** — deployment target for the upstream demo site.
- **OpenAI SDK browser usage** — `dangerouslyAllowBrowser: true` that sent API keys directly from the browser.

## Server-Side Proxy and SSRF

The proxy accepts user-configured `baseUrl` values and forwards requests server-side. This creates a server-side request capability that the browser-first architecture did not have. Mitigations:

- `validateUpstreamUrl` rejects schemes other than `http:`/`https:`, URLs containing userinfo, and the following hosts/addresses (cloud metadata endpoints, link-local, RFC 1918 private ranges on both IPv4 and IPv6, IPv4/IPv6 loopback, `localhost`, `*.internal`, `*.local`, `0.0.0.0`).
- The proxy only appends `/chat/completions` or `/models` as path suffixes.
- The `/api/keys` endpoint requires the request `Origin` header to match the request `Host` (same-origin check via URL parser; previously used `origin.endsWith(host)` which was trivially bypassable).
- Imported server configurations are validated field-by-field (`connectionType` must be one of the enum values, `id` must be non-empty, `baseUrl` must parse, `isVerified` is reset to `null`, `isEnabled` reset to `false`) so a crafted JSON file cannot pre-verify a connection to a malicious URL.
- `PUBLIC_CSP_CONNECT_SOURCES` tokens are validated to reject characters that could break out of a CSP source token and inject a new directive (`;`, whitespace, control chars).

With default settings (typical localhost/Docker deployment), SSRF has limited impact. The defenses above are belt-and-suspenders for non-default deployments where users supply their own `baseUrl`.

**Known SSRF limitation — operator responsibility for DNS resolution.** The lexical-pattern blocklist above does NOT resolve hostnames to IPs and check the resolved IP against the blocklist. A user-supplied `baseUrl` whose hostname resolves to a private IP at fetch time (e.g. via `localtest.me`, `lvh.me`, a corporate DNS tunnel, or an attacker-controlled wildcard record) will be fetched by the server even though the literal hostname string passes the blocklist. Typical deployment on localhost or in operator-managed Docker is unaffected. Operators exposing this server to a wider trust boundary, or expecting it to defend against users who supply their own `baseUrl`, are responsible for auditing the domains users set. The full DNS-rebinding defense (resolve + re-validate + refetch on resolved IP) is a future improvement.

## Electron Environment Forwarding

The Electron desktop app runs an embedded SvelteKit process via `utilityProcess.fork()`. The embedded process cannot read arbitrary env vars from the parent (Electron) process — only those in an explicit whitelist. The whitelist covers:

- `PORT`, `PUBLIC_ADAPTER` — runtime identity
- `HOME`, `PATH` — shell utilities
- `OPENAI_API_KEY` — credential for the OpenAI/Compatible proxy
- `PUBLIC_CSP_CONNECT_SOURCES` — CSP source list
- `NODE_ENV` — runtime mode
- `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` — corporate proxy routing
- `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED` — TLS configuration for corporate CA bundles

Operators needing additional env vars forwarded to the embedded server (e.g. custom CA cert paths, service-mesh sidecar addresses) edit the whitelist in `electron/main.js`. Adding a var to the whitelist is a deliberate trust grant — the embedded server can then act on it.
