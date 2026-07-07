# Session Affinity Key

The session affinity key enables Fireworks AI prompt caching by sending a `prompt_cache_key` parameter with chat completion requests. This routes requests with the same key to the same cache slot, so the system prompt and conversation prefix are cached and reused across turns.

![Fireworks connection config with session affinity key and custom headers](screenshots/settings-fireworks.png)

## How it works

1. User sets a session affinity key in Settings → Connection (OpenAI-Compatible only)
2. The key is stored in `server.sessionAffinityKey` in localStorage
3. On each chat request, the client includes `sessionAffinityKey` in the body sent to `/api/chat`
4. The proxy maps it to `prompt_cache_key` in the upstream request body

### Client side (`src/lib/chat/openai.ts`)

```typescript
const trimmedKey = this.server.sessionAffinityKey?.trim();
const body = { baseUrl, model, messages, stream: true };
if (trimmedKey && this.server.connectionType === ConnectionType.OpenAICompatible) {
    body.sessionAffinityKey = trimmedKey;
}
```

The guard ensures:
- Whitespace-only keys are treated as empty (`.trim()`)
- The key is only sent for `OpenAICompatible` connections (not OpenAI Official, which doesn't support `prompt_cache_key`)

### Server side (`src/routes/api/chat/+server.ts`)

```typescript
if (sessionAffinityKey) {
    upstreamBody.prompt_cache_key = sessionAffinityKey;
}
```

The proxy passes the key through without modification. It only appears in chat completion requests — not model listing.

## Why prompt caching matters

Hollama sends messages as a clean append-only array:

```json
{
    "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
    "messages": [
        {"role": "system", "content": "You are a helpful assistant"},
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
        {"role": "user", "content": "Tell me more"}
    ],
    "stream": true,
    "prompt_cache_key": "hollama-session-1"
}
```

Each new turn appends to the end — the prefix (system prompt + prior turns) is identical to the previous request. With `prompt_cache_key`, Fireworks caches this prefix and only processes the new tokens. No dynamic metadata, tool definitions, or system reminders are injected between turns, so the cache prefix is always stable.

## Scope

- **OpenAI-Compatible only.** The sessionAffinityKey input is hidden for OpenAI Official and Ollama connections. OpenAI's official API does not support `prompt_cache_key`.
- **Chat completions only.** The key is not sent with model listing requests.
- **Auto-clear on type change.** A `$effect` in `Connection.svelte` clears `sessionAffinityKey` to `undefined` when `connectionType` changes away from `OpenAICompatible`.

## Key files

| File | Role |
|---|---|
| `src/lib/chat/openai.ts` | Client-side guard — only includes key for OpenAICompatible + non-empty |
| `src/routes/api/chat/+server.ts` | Proxy — maps `sessionAffinityKey` → `prompt_cache_key` |
| `src/routes/settings/Connection.svelte` | UI — input field, $effect for auto-clear |
| `tests/openai.test.ts` | E2E — key sent, not sent, whitespace, OpenAI Official excluded |
| `tests/session-affinity.test.ts` | E2E — conditional rendering, auto-clear $effect |
