# Fireworks Reasoning Support

Support for structured reasoning via `reasoning_effort` and `reasoning_content` fields, designed for Fireworks AI models that support thinking/reasoning (e.g., DeepSeek R1, QwQ).

## Features

- **Reasoning effort toggle** — Sparkles button in the prompt toolbar for Fireworks endpoints
- **Reasoning content parsing** — `reasoning_content` extracted from SSE deltas alongside `content`
- **Collapsible reasoning display** — reasoning blocks render in a collapsible UI, auto-open while streaming, auto-collapse when main content starts
- **Multi-turn carry** — reasoning from prior turns is stored on the message and re-sent as `reasoning_content` in subsequent requests

## Request flow

### Client → Proxy

The session stores `reasoningEffort` (e.g., `"low"`, `"high"`). On chat request:

```typescript
// src/routes/sessions/[id]/+page.svelte
let chatRequest = {
    model: session.model.name,
    messages: chatMessagesForRequest,
    ...(session.reasoningEffort && { reasoningEffort: session.reasoningEffort })
};
```

Messages with prior reasoning include `reasoning_content`:

```typescript
...(msg.role === 'assistant' && msg.reasoning && { reasoning_content: msg.reasoning })
```

### Proxy → Upstream

```typescript
// src/routes/api/chat/+server.ts
if (reasoningEffort) {
    upstreamBody.reasoning_effort = reasoningEffort;
}
```

The proxy passes the field through to the upstream provider.

### Response parsing

The SSE parser in `src/lib/chat/openai.ts` extracts both `content` and `reasoning_content` from each chunk's delta:

```typescript
const delta = parsed.choices?.[0]?.delta;
const content = delta?.content;
if (content) onChunk(content);
const reasoningContent = delta?.reasoning_content;
if (reasoningContent && onReasoningChunk) onReasoningChunk(reasoningContent);
```

The parser uses a line-by-line SSE reader with a 1MB buffer safety cap (`MAX_SSE_BUFFER`) to prevent memory exhaustion from malformed streams.

## UI

### Sparkles toggle (`Prompt.svelte`)

A toggle button appears in the prompt toolbar when the connected server's `baseUrl` contains `fireworks.ai`. Clicking it cycles `session.reasoningEffort` through available levels.

### Reasoning display (`+page.svelte`)

Reasoning content streams into a collapsible block above the main response. The block:
- Auto-opens when reasoning tokens start arriving
- Auto-collapses when the first main content token arrives
- Can be manually toggled open/closed after completion
- Renders `<think>` and `<thought>` tags from the SSE stream

## Data model

```typescript
// src/lib/sessions.ts
interface Session {
    // ...existing fields...
    systemPromptText?: string;
    reasoningEffort?: string;  // e.g., "low", "high"
}

// src/lib/chat/index.ts
interface ChatRequest {
    // ...existing fields...
    reasoningEffort?: string;
}

interface Message {
    // ...existing fields...
    reasoning?: string;        // stored reasoning from prior turns
    reasoning_content?: string; // sent in request for multi-turn carry
}
```

## Key files

| File | Role |
|---|---|
| `src/routes/sessions/[id]/Prompt.svelte` | Sparkles toggle, Fireworks detection |
| `src/routes/sessions/[id]/+page.svelte` | Reasoning stream handling, collapsible display |
| `src/routes/sessions/[id]/Controls.svelte` | System prompt textarea |
| `src/lib/chat/openai.ts` | SSE parsing — `reasoning_content` extraction |
| `src/routes/api/chat/+server.ts` | Proxy — `reasoning_effort` passthrough |
| `src/lib/chat/index.ts` | `ChatRequest` and `Message` interfaces |
| `src/lib/sessions.ts` | `Session` interface with `reasoningEffort` |
| `tests/controls.test.ts` | System prompt and reasoning tests |
| `tests/openai.test.ts` | Copy button, system prompt payload tests |
