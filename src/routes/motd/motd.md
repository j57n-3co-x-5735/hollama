# Getting started with Hollama

Hollama is a private chat app for large language models. It talks directly to models
running **on your own machine** (Ollama, LM Studio, llama.cpp) and to hosted APIs
(OpenAI, Fireworks, and any OpenAI‑compatible endpoint). Your conversations are stored
locally in this app — they are only ever sent to the model provider you choose.

This guide takes you from an empty app to your first chat, then covers every feature.

---

## 1. Connect to a provider

**Before you start:** Hollama doesn't ship models — it talks to a model server that _you_
run. Get one running first:

- **Ollama** — install it, then in a terminal run `ollama serve` and pull a model,
  e.g. `ollama pull llama3.2`.
- **LM Studio** — open it, download a model, then start the local server from the
  **Developer** tab _inside LM Studio_ (not in Hollama).
- **Hosted APIs** (OpenAI, Fireworks) — no local server needed; you'll just need an API key.

Then, in Hollama, open **Settings** (the gear icon in the sidebar). Settings is a single
scrolling page; the areas named below (Servers, Files, Network Activity…) are sections on
that page, not separate tabs. In the **Servers** section, choose a connection type and click
**Add connection**. There are four types:

| Type                           | Use it for                                                       | API key                         |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------- |
| **Ollama**                     | Models run locally by [Ollama](https://ollama.com)               | Not needed (no key field shown) |
| **LM Studio**                  | Models run locally by [LM Studio](https://lmstudio.ai)           | Not needed (no key field shown) |
| **OpenAI: Compatible servers** | llama.cpp, vLLM, Fireworks — anything that speaks the OpenAI API | Optional on desktop             |
| **OpenAI: Official API**       | OpenAI's hosted models                                           | Required                        |

Each connection needs a **Base URL** — the address where the server is listening:

- **Ollama** — usually `http://localhost:11434`
- **LM Studio** — usually `http://localhost:1234/v1`
- **llama.cpp / other compatible** — e.g. `http://localhost:8080/v1`
- **Fireworks** — add it as an **OpenAI: Compatible** connection with base URL
  `https://api.fireworks.ai/inference/v1`, and paste your Fireworks key

Then click **Verify**. Hollama tests the connection and, on success, loads that server's
models. A green confirmation toast means you're ready.

### Do I need an API key?

- **Local servers you run yourself** (Ollama, LM Studio, or llama.cpp on `localhost`) need
  **no key**. Ollama and LM Studio don't even show a key field. An **OpenAI: Compatible**
  connection _does_ show a key field, but on the desktop app you can leave it blank for a
  local server.
- **Hosted APIs** (OpenAI, Fireworks) need a key. Paste it into the **API key** field. It is
  stored on the server side and is never exposed to the web page.

> **Nothing is sent until you choose it.** Adding a connection and verifying it only contacts
> that one server. Hollama never phones home.

---

## 2. Pick a model and start chatting

1. Open the **Sessions** tab and click **New session**.
2. Click the model dropdown just **above the prompt box at the bottom** of the screen.
   **Start typing to filter** — the list contains every model from every verified connection.
3. Write your message in the prompt box and press **Run** (or `Enter`).

> **Dropdown empty?** Your server is running but has no model loaded yet. For **Ollama**, pull
> one from the connection in **Settings → Servers** (there's a model field with a download
> button). For **LM Studio**, load a model and make sure its server is started.

A _session_ is a single conversation. Create as many as you like; each is saved
automatically and listed newest‑first in the sidebar. `Shift`+`Enter` inserts a newline
instead of sending.

---

## 3. Organize sessions with folders

In the Sessions sidebar, click **New folder** to create one.

- **Click a folder's title** to expand or collapse it.
- **Rename** with the pencil icon that appears when you hover over the folder.
- **Move a session in** by dragging it onto the folder — or use the session's move menu
  (keyboard‑friendly) and pick the folder.

Folders and their expanded/collapsed state are remembered between launches.

---

## 4. System prompts

A system prompt is a standing instruction that shapes how the model responds (tone, role,
rules). You can set two kinds:

- **Per‑session** — the **document icon** in the session header (it turns into a notebook
  icon once a prompt is set). Applies to that one conversation.
- **Global** — the **System Prompt** item in the sidebar (just below Settings). Applies to
  every new session.

System prompts are treated as configuration, not chat content — they are _not_ included when
you copy or export a conversation.

---

## 5. Reasoning (show the model's thinking)

The **✨ Sparkles** button in the prompt toolbar turns on reasoning. For models that support
it (many local and hosted "thinking" models), Hollama asks the model to stream its
step‑by‑step reasoning, shown in a collapsible **Reasoning** block above the answer.

You can turn it on for any provider. If the model you're using doesn't support reasoning,
Hollama automatically retries without it and shows a small notice — you still get an answer,
never an error. Reasoning traces are not included in copy/export.

---

## 6. Attach files from your computer

The **folder** icon in the prompt toolbar opens the file browser. Pick a file and its text
is added to your next message as context. Choose the **pin** to keep a file attached across
several messages, or the **plus** to attach it just once.

**File access is off until you point it at a folder.** In the desktop app, open
**Settings → Files** and type an absolute path (for example `/home/you/Documents`), then click
**Save**. It takes effect immediately — no restart. You can list several folders separated by
a colon (`:`). (Advanced: the `HOLLAMA_FILES_DIR` environment variable does the same thing;
the Settings field overrides it.)

Only text files are read, and only from inside the folder you configured — nothing outside it
is accessible.

---

## 7. Knowledge and images

- **Knowledge** — first create reusable snippets of text in the **Knowledge** tab. Then the
  **brain icon** in the prompt toolbar lets you attach a saved snippet to a message — handy
  for reference material you paste often. (On a fresh install the brain menu is empty until
  you've created a snippet.)
- **Images** — the **image icon** attaches pictures to a prompt for vision‑capable models.
  You can also paste an image directly into the prompt.

---

## 8. Search, copy, and export a conversation

Every session header has:

- **🔍 Search** — find text within the current conversation (or press `Ctrl`/`Cmd`+`F`).
- **Copy / export** — copy the conversation as Markdown or JSON, or download it as a `.md`
  file.

These are available for every provider.

---

## 9. Your privacy

Hollama is built to keep your data on your machine:

- Conversations, folders, and knowledge live in this app's local storage — not on any server.
- API keys are held **server‑side** and never handed to the web page.
- The desktop app watches outbound traffic; the **Network Activity** section in Settings lists
  any request that leaves your machine, so you can confirm nothing unexpected is sent.
- Talking to a local server (`localhost`, also called _loopback_) never requires a key and
  never leaves your computer.

---

## Where things live

| I want to…                           | Go to                                   |
| ------------------------------------ | --------------------------------------- |
| Add or verify a provider             | **Settings → Servers** section          |
| Set a global system prompt           | **System Prompt** (sidebar item)        |
| Choose the file‑picker source folder | **Settings → Files** section (desktop)  |
| See what left my machine             | **Settings → Network Activity** section |
| Import or export all my data         | **Settings → Data management** section  |
| Start or organize chats              | **Sessions** tab                        |
| Save reusable snippets               | **Knowledge** tab                       |

---

Hollama is open source. Contributions in **Svelte**, **TypeScript**, and **TailwindCSS** are
welcome — see [`CONTRIBUTING.md`](https://github.com/fmaclen/hollama/blob/main/CONTRIBUTING.md).
Originally created by [@fmaclen](https://fernando.is) and
[contributors](https://github.com/fmaclen/hollama/graphs/contributors).
