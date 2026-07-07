# Hollama

A private chat app for large language models. Talks directly to models running on your own machine (Ollama, LM Studio) and to hosted APIs (OpenAI, Fireworks, and any OpenAI-compatible endpoint). Conversations are stored locally — they are only ever sent to the model provider you choose.

This is a privacy-hardened fork of [Hollama](https://github.com/fmaclen/hollama). API keys never reach the browser — all upstream calls go through a server-side proxy with credential isolation, SSRF protection, and a strict Content Security Policy.

### Get started

- Download for [macOS, Windows & Linux](https://github.com/fmaclen/hollama/releases)
- [Self-hosting](SELF_HOSTING.md) with Docker
- [Quickstart](docs/quickstart.md) — build, run, configure
- [Architecture & docs](docs/overview.md)

---

|  |  |
| --- | --- |
| ![Conversations with folders, multi-select, file context, and reasoning](docs/screenshots/session-folders-multiselect.png) | ![In-conversation search with match highlighting](docs/screenshots/session-search.png) |
| Organize conversations into **folders**. **Multi-select** for batch operations. File attachments inject context directly into the conversation. Responses include collapsible **reasoning** traces. | Search within a conversation with **Ctrl+F** — matches are highlighted across all messages with prev/next navigation. |
| ![Multi-provider model picker showing Fireworks and LM Studio](docs/screenshots/session-model-picker.png) | ![Built-in getting started guide](docs/screenshots/getting-started.png) |
| Switch between models from **multiple providers** in one picker — Ollama, LM Studio, Fireworks, and OpenAI side by side, each labeled by connection. | A built-in **Getting Started** guide walks through connecting a provider, choosing a model, and using every feature. |
| ![Fireworks config with session affinity and custom headers](docs/screenshots/settings-fireworks.png) | ![Knowledge base and global system prompt](docs/screenshots/knowledge-system-prompt.png) |
| Configure **Fireworks AI** with session affinity keys for prompt caching, API keys stored server-side, and custom headers per connection. | Store reusable context in the **knowledge base**. Set a **global system prompt** that applies to every session, or override per-session. |

---

### Features

**Providers & models**
- Ollama, LM Studio, OpenAI, Fireworks, and any OpenAI-compatible server
- Multi-server support — connect to several providers at once
- Text & vision models
- Reasoning model support across all providers (`reasoning_effort` + `reasoning_content` parsing)
- Session affinity keys for Fireworks prompt cache reuse

**Conversations**
- Folder organization with drag-to-move and inline rename
- In-conversation search (Ctrl/Cmd+F) with match highlighting and navigation
- File attachments with configurable source directories
- Conversation copy & export (Markdown, JSON, `.md` download)
- Per-session and global system prompts
- Edit & retry messages
- Multi-select batch delete
- Large prompt field with code editor toggle

**Interface**
- Markdown rendering with syntax highlighting
- KaTeX math notation
- Sidebar search across all conversations
- Byte-based storage cap with usage warnings
- Light & dark themes
- Responsive layout
- Multi-language interface (EN, DE, ES, FR, JA, PT-BR, TR, VI, ZH-CN)

**Privacy & security**
- Server-side API proxy — keys never reach the browser
- Credential isolation (`.hollama/credentials.json`, mode `0600`)
- SSRF protection — blocks private IPs, cloud metadata, loopback
- Strict CSP — no inline scripts, no outbound telemetry
- No analytics, no update checks
- Import & export stored data

**Desktop**
- Electron builds for macOS, Windows, and Linux
- CORS bypass via `onHeadersReceived` interceptor (no `webSecurity: false`)
- Download Ollama models directly from the UI

---

### More screenshots

| | |
| --- | --- |
| ![Per-session system prompt with reasoning](docs/screenshots/session-system-prompt.png) | ![Sidebar search filtering conversations](docs/screenshots/sidebar-search.png) |
| Per-session system prompt panel — set instructions for a single conversation without affecting others. | Search the sidebar to filter conversations across all folders. |
| ![Folder creation with inline rename](docs/screenshots/sidebar-folder-create.png) | ![LM Studio connection and file source config](docs/screenshots/settings-lmstudio-files.png) |
| Create folders inline and rename them in place. Multi-select sessions with checkboxes for batch operations. | LM Studio connection setup. The **Files** section lets you configure which directories the file picker reads from. |
