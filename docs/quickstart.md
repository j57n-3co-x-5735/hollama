# Quickstart

## Build and run

### Electron (desktop)

```bash
git clone <repo-url>
cd hollama
npm install
npm run electron:build
```

The build output is in `dist/`. Run the platform-specific binary.

### Node.js (server)

```bash
npm install
npm run build
node build
```

The server listens on `http://localhost:3000` by default.

### Development

```bash
npm run dev
```

HMR-enabled dev server on `http://localhost:5173`.

### Docker

```bash
docker build -t hollama .
docker run -p 3000:3000 \
    -e OPENAI_API_KEY=sk-your-key \
    hollama
```

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | Server-wide API key for all OpenAI-compatible connections. Highest priority in credential resolution — overrides per-connection keys. | — |
| `PORT` | Server listen port | `3000` (build), `5173` (dev) |
| `PUBLIC_CSP_CONNECT_SOURCES` | Additional CSP `connect-src` origins, space-separated. Use when the browser needs to reach hosts not covered by the proxy (e.g., Ollama on a non-localhost address). | — |
| `HOLLAMA_DATA_DIR` | Directory for `credentials.json` (API keys + custom headers). Note: not forwarded by Electron env whitelist — only effective in Node/Docker deployments. | `$CWD/.hollama` |
| `NODE_ENV` | Set to `production` for build mode | — |

## First connection

1. Open the app → Settings page
2. Choose a connection type (Ollama, OpenAI Official, or OpenAI-Compatible)
3. Click "Add connection"
4. Enter the base URL (pre-filled for OpenAI and Ollama)
5. For OpenAI/Compatible: enter your API key
6. (Optional) Add custom headers, session affinity key
7. Click **Verify** — the app submits credentials to the server, then tests the connection

On success, models appear in the dropdown on the Sessions page.

## Authentication modes

The proxy supports three ways to provide API keys:

1. **Environment variable** (`OPENAI_API_KEY`) — applies to all connections, highest priority
2. **Settings UI** — per-connection key entered in the browser, stored server-side in `credentials.json`
3. **Request header** (`x-api-key`) — per-request, ephemeral, not cached. Useful for programmatic access or key rotation testing.

If `OPENAI_API_KEY` is set, the Settings UI still shows the API key input but the env key takes priority. The `x-api-key` header is the lowest priority — it's used only when neither env nor stored credentials exist for the given `baseUrl`.

## Self-hosting notes

See `SELF_HOSTING.md` in the repo root for additional self-hosting guidance, including reverse proxy configuration and credential persistence.
