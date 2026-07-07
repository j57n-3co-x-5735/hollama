# Self-hosting (with Docker)

- [Getting started](#getting-started)
- [Updating to the latest version](#updating-to-the-latest-version)
- [Connecting to an Ollama server hosted elsewhere](#connecting-to-an-ollama-server-hosted-elsewhere)
- [Configuring allowed hosts](#configuring-allowed-hosts)

## Getting started

To host your own Hollama server, [install Docker](https://www.docker.com/products/docker-desktop/) and run the command below in your favorite terminal:

```shell
docker run --rm -d -p 4173:4173 --name hollama ghcr.io/fmaclen/hollama:latest
```

Then visit [http://localhost:4173](http://localhost:4173)

## Updating to the latest version

To update, first stop the container:

```shell
docker stop hollama
```

Then pull the latest version:

```shell
docker pull ghcr.io/fmaclen/hollama:latest
```

Finally, start the container again:

```shell
docker run --rm -d -p 4173:4173 --name hollama ghcr.io/fmaclen/hollama:latest
```

## Connecting to an Ollama server hosted elsewhere

If you are using the publicly hosted version or your Docker server is on a separate device than the Ollama server you'll have to set the domain in `OLLAMA_ORIGINS`. [Learn more in Ollama's docs](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server).

```bash
OLLAMA_ORIGINS=https://hollama.fernando.is ollama serve
```

## Configuring allowed hosts

When hosting Hollama behind a reverse proxy or in a Kubernetes environment, you'll need to specify which domains are allowed to access the application. Use the `VITE_ALLOWED_HOSTS` environment variable to set this:

```shell
docker run --rm -d -p 4173:4173 \
  -e VITE_ALLOWED_HOSTS='your-domain.com,another-domain.com' \
  --name hollama ghcr.io/fmaclen/hollama:latest
```

Multiple domains can be specified by separating them with commas. If not specified, only 'localhost' will be allowed.

## Persisting credentials across container restarts

API keys and custom HTTP headers entered in **Settings → Connections** are sent to the server at `/api/keys` and persisted on disk at `.hollama/credentials.json` (mode `0600`, atomic temp+rename writes). If you run Hollama in a Docker container without mounting a persistent volume at that path, **the credentials will be silently lost on container restart or recreation**.

To keep credentials across container restarts, mount a host directory or named volume into the container and point the server at it via the `HOLLAMA_DATA_DIR` environment variable:

```shell
docker run --rm -d -p 4173:4173 \
  -v hollama-data:/hollama-data \
  -e HOLLAMA_DATA_DIR=/hollama-data \
  --name hollama ghcr.io/fmaclen/hollama:latest
```

The mounted directory must be writable by the user the server runs as inside the container. If you mount an existing host directory, ensure its permissions allow the process to create `.hollama/credentials.json` and to write with mode `0600`. A named volume managed by Docker is the simplest config — the Docker daemon owns the directory and the server sees it as writable.

If you do not set `HOLLAMA_DATA_DIR`, credentials will be written relative to the server's working directory inside the container (typically the build output directory, which is not a persistent volume). You'll see them silently vanish on container restart.

To clear persisted credentials, either:
- Delete `$HOLLAMA_DATA_DIR/credentials.json` (or `./.hollama/credentials.json` if no `HOLLAMA_DATA_DIR` is set) and restart the container, OR
- Call `DELETE /api/keys` (the server unlinks the file).

Header-supplied per-request credentials (`x-api-key` header) are not persisted and not cached — they apply to one request only. Env-supplied credentials (`OPENAI_API_KEY` env var) are not persisted either — they apply to the process lifetime.
