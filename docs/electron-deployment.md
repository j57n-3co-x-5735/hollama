# Electron Deployment

Hollama ships as an Electron desktop app that bundles the SvelteKit server and Chromium renderer in a single binary.

## Architecture

```
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│                                         │
│  1. Filter environment variables        │
│  2. Start SvelteKit server (child)      │
│  3. Wait for server to be ready         │
│  4. Install onHeadersReceived hook      │
│  5. Open BrowserWindow → localhost:PORT │
└─────────────────────────────────────────┘
```

The main process (`electron/main.js`) starts the SvelteKit Node server as a utility process, waits for it to bind, then opens a BrowserWindow pointed at `http://127.0.0.1:${PORT}`.

### CORS handling

The SvelteKit proxy handles CORS for upstream API calls (server-to-server requests have no CORS). For any remaining browser-direct requests (e.g., Ollama on localhost), Electron uses a `session.defaultSession.webRequest.onHeadersReceived` interceptor:

```javascript
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Skip localhost — no CORS injection needed for the local server
    const url = new URL(details.url);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return callback({ cancel: false });
    }
    callback({
        responseHeaders: {
            ...details.responseHeaders,
            'Access-Control-Allow-Origin': ['*'],
            'Access-Control-Allow-Headers': ['*'],
            'Access-Control-Allow-Methods': ['GET, POST, OPTIONS']
        }
    });
});
```

This replaces the upstream `webSecurity: false` approach. `webSecurity` stays at its default `true`, preserving same-origin policy and CSP enforcement. The interceptor only injects CORS headers on responses from external hosts — it does not disable any security checks.

### Environment whitelist

The main process filters environment variables before spawning the server. Only these variables are passed through:

```
PORT, PUBLIC_ADAPTER, HOME, PATH, HOLLAMA_DATA_DIR, HOST, ORIGIN,
OPENAI_API_KEY, PUBLIC_CSP_CONNECT_SOURCES, NODE_ENV,
HTTP_PROXY, HTTPS_PROXY, NO_PROXY,
NODE_EXTRA_CA_CERTS, NODE_TLS_REJECT_UNAUTHORIZED
```

- `HOLLAMA_DATA_DIR` is set to `app.getPath('userData')/data` (e.g., `~/.config/hollama/data` on Linux) so credential persistence works in packaged builds.
- `HOST` is set to `127.0.0.1` so the server only accepts local connections (not network-accessible).
- `ORIGIN` is set to `http://127.0.0.1:{port}` so adapter-node constructs request URLs with the correct protocol (it defaults to `https` otherwise).
- The proxy and TLS variables support corporate network environments.

## Building

```bash
npm run electron:build
```

This runs `npm run build` (SvelteKit) then packages with Electron. Output goes to `dist/`.

The Electron build requires `adapter-node` (the default in this fork). The build produces platform-specific binaries.

## Deployment modes

| Mode | How | Notes |
|---|---|---|
| Electron desktop | `npm run electron:build` → distribute binary | Self-contained, CORS handled by interceptor |
| Docker / Node | `npm run build && node build` | Set `OPENAI_API_KEY` and `PORT` env vars |
| Dev server | `npm run dev` | HMR, no Electron shell |

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | Server-wide API key (highest priority in credential resolution) | — |
| `PORT` | Server listen port | `5173` (dev), `3000` (build) |
| `PUBLIC_CSP_CONNECT_SOURCES` | Additional CSP connect-src origins (space-separated) | — |
| `HOLLAMA_DATA_DIR` | Directory for `credentials.json` | `app.getPath('userData')/data` (Electron), `$CWD/.hollama` (Node) |

## Key files

| File | Role |
|---|---|
| `electron/main.js` | Main process — env filtering, server launch, CORS interceptor, window creation |
| `electron/network-audit.js` | Optional network audit module for verifying no unauthorized requests |
