# Testing Guide

## Running tests

```bash
# All tests
npx playwright test

# Single file
npx playwright test tests/security.test.ts

# With trace (for debugging)
npx playwright test --trace on

# With UI
npx playwright test --ui
```

Tests require a build first (`npm run build`) or use the dev server. The Playwright config runs `npm run build && npm run preview` as the web server.

## Test file inventory

### Unit tests (direct function import, no browser)

These import functions directly and run in Node context via Playwright's test runner.

| File | Tests | What it covers |
|---|---|---|
| `security.test.ts` | ~60 | `validateUpstreamUrl` (SSRF), `sanitizeHeaders` (blocklist, control chars), `sanitizeImportedServer` (import validation), `resolveApiKey` (credential resolution), `checkOrigin` (CSRF), `isValidCspSource` (CSP injection) |
| `fireworks-models.test.ts` | 28 | `fetchFireworksModels` — model name mapping, pagination, headers forwarding, error paths, empty/non-standard responses, baseUrl resolution |
| `models-handler.test.ts` | 13 | `handleModelsRequest` — standard path, Fireworks fallback decision tree, auth errors (no fallback), non-Fireworks errors, extraHeaders stripping |

These tests use injectable `fetchFn` parameters to mock upstream HTTP without Playwright's browser-level route interception. This allows precise control over call sequences — the `makeTracedFetch` helper records every URL and header, then returns responses from a queue.

### E2E tests (Playwright browser)

| File | Tests | What it covers |
|---|---|---|
| `openai.test.ts` | 19 | OpenAI integration (auth errors, network errors, model listing, model filter), session affinity (sent/not-sent/whitespace/OpenAI-excluded), Fireworks fallback (auth/403/probeChat/network), copy button, system prompt payload |
| `servers.test.ts` | 8 | Server management, migration, model toggling, connection naming, session affinity visibility |
| `session-affinity.test.ts` | 6 | Conditional rendering by connection type, $effect auto-clear of stale keys |
| `extra-headers.test.ts` | 6 | oninput propagation, case-insensitive dedup, MAX_ENTRIES cap |
| `controls.test.ts` | 11 | System prompt (payload ordering, boundary cases, persistence, backward compat), reasoning effort, Ollama controls |
| `data-management.test.ts` | 12 | Delete/export/import for servers, sessions, knowledge, preferences; system prompt export/import round-trip |
| `session-interaction.test.ts` | 18 | Message send/receive, copy, stop, edit, retry, auto-scroll, error handling, navigation, math rendering, image attachment, localStorage full |
| `session-management.test.ts` | 7 | Session init, ID generation, state persistence, navigation, delete, title editing |
| `session-reasoning.test.ts` | 5 | `<think>` and `<thought>` tag parsing, streaming reasoning, auto-collapse |
| `attachments.test.ts` | 8 | Knowledge attachments, image attachments (Ollama/OpenAI), clipboard paste |
| `knowledge.test.ts` | 5 | Create, edit, delete, use as system prompt |
| `locales.test.ts` | 9 | Language switching, default locale detection |
| `sidebar-desktop.test.ts` | 9 | Toggle, persistence, navigation, content sections, theme |
| `sidebar-mobile.test.ts` | 4 | Auto-collapse behavior on navigation |
| `ui.test.ts` | 4 | FieldSelect filtering, model grouping, badges |
| `version.test.ts` | 4 | Version display, no GitHub requests, no Plausible requests |
| `docs.test.ts` | 1 | Screenshot snapshot for README |

### Test utilities

`tests/utils.ts` — shared helpers:

- `mockOllamaModelsResponse()` — seeds an Ollama server and mocks the tags endpoint
- `mockOpenAIModelsResponse()` — mocks `/api/models` and `/api/keys` for OpenAI
- `mockOpenAICompletionResponse()` — mocks `/api/chat` SSE stream
- `mockOpenAICompletionResponseWithCapture()` — same but captures the request body for assertions
- `setupStreamedCompletionMock()` — real HTTP server for Ollama streaming tests (CORS headers: `Content-Type, X-Api-Key, Accept, Authorization`)
- `chooseFromCombobox()`, `chooseModel()` — UI interaction helpers
- Mock data constants (`MOCK_OPENAI_MODELS`, `MOCK_API_TAGS_RESPONSE`, etc.)

## Test patterns

### Unit testing server modules

Server-side modules (`fireworks-models.ts`, `models-handler.ts`) accept an optional `fetchFn` parameter that defaults to global `fetch`. Tests inject a mock:

```typescript
const { fetchFn, calls } = makeTracedFetch([
    new Error('network error'),           // standard /models fails
    jsonResponse({ models: [{ name: 'm1' }] })  // proprietary succeeds
]);

const result = await handleModelsRequest(
    { baseUrl: FIREWORKS_BASE, apiKey: 'sk-test', signal },
    fetchFn
);

expect(calls).toHaveLength(2);  // standard failed, proprietary called
expect(result.status).toBe(200);
```

This pattern avoids Playwright route interception for server-side logic and allows structural assertions on call sequences.

### E2E testing with proxy mocks

E2E tests mock the proxy endpoints (not upstream APIs):

```typescript
await page.route('**/api/keys', (route) => route.fulfill({ json: { ok: true } }));
await page.route('**/api/models**', (route) => {
    route.fulfill({ json: { data: MOCK_OPENAI_MODELS } });
});
```

This tests the full client → proxy path. The proxy's internal behavior (Fireworks fallback, header sanitization) is covered by the unit tests above.

### Capturing request bodies

To verify what the client sends to the proxy:

```typescript
const getBody = await mockOpenAICompletionResponseWithCapture(page, MOCK_RESPONSE);
// ... trigger the request ...
const body = getBody();
expect(body.sessionAffinityKey).toBe('test-key');
```
