<script lang="ts">
	import { FileText, NotebookPen, Search } from 'lucide-svelte';
	import { onMount, tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { get } from 'svelte/store';
	import { slide } from 'svelte/transition';

	import LL from '$i18n/i18n-svelte';
	import { beforeNavigate } from '$app/navigation';
	import { type ChatRequest, type ChatStrategy } from '$lib/chat';
	import { OllamaStrategy } from '$lib/chat/ollama';
	import { OpenAIStrategy } from '$lib/chat/openai';
	import Button from '$lib/components/Button.svelte';
	import ButtonDelete from '$lib/components/ButtonDelete.svelte';
	import Head from '$lib/components/Head.svelte';
	import Header from '$lib/components/Header.svelte';
	import Metadata from '$lib/components/Metadata.svelte';
	import SessionExportMenu from '$lib/components/SessionExportMenu.svelte';
	import { ConnectionType } from '$lib/connections';
	import { serversStore, sessionsStore, settingsStore } from '$lib/localStorage';
	import {
		buildSystemMessages,
		formatSessionMetadata,
		getSessionTitle,
		loadSession,
		saveSession,
		type Editor,
		type Message
	} from '$lib/sessions';
	import { Sitemap } from '$lib/sitemap';

	import type { PageData } from './$types';
	import Controls from './Controls.svelte';
	import InConversationSearch from './InConversationSearch.svelte';
	import Messages from './Messages.svelte';
	import Prompt from './Prompt.svelte';
	import { createReasoningProcessor } from './reasoningProcessor';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let session = $state(loadSession(data.id));
	let editor = $state<Editor>({
		prompt: '',
		view: 'messages',
		messageIndexToEdit: null,
		isCodeEditor: false,
		isCompletionInProgress: false,
		shouldFocusTextarea: false,
		isNewSession: true
	});
	let messagesWindow: HTMLDivElement | undefined = $state();
	// Seed from the loaded session so the model-sync effect below never sees a
	// transient `undefined` on mount (which it would otherwise mistake for a
	// user clearing the selection and write back, dropping the session's model).
	// Capturing only the initial value is intentional — later session changes are
	// handled by handleSessionChange, not this seed.
	// svelte-ignore state_referenced_locally
	let modelName: string | undefined = $state(session.model?.name);
	let userScrolledUp = $state(false);
	let shouldConfirmDeletion = $state(false);
	let showSessionPrompt = $state(false);
	let systemPromptButton: HTMLButtonElement | undefined = $state();
	let isMessageSearchOpen = $state(false);

	// Search is only meaningful in the messages view of a session that has
	// messages: the controls view has no messages container to search (its bar
	// would be dead — messagesWindow is unbound there), and an empty chat has
	// nothing to find. Derive it once so the button gate and the Ctrl/Cmd+F
	// handler share a single condition and can't drift apart.
	const canSearch = $derived(!editor.isNewSession && editor.view === 'messages');

	// Close any open search when leaving the messages view, so a bar opened in
	// messages can't linger (dead) after a switch to the controls view.
	$effect(() => {
		if (editor.view !== 'messages') isMessageSearchOpen = false;
	});

	// Whether `session` was already present in the store when the current
	// completion started. Read by persistCompletionResult() to tell a
	// brand-new session's first save (a create — must persist) apart from an
	// existing session deleted mid-stream (a resurrection — must NOT persist).
	// Non-reactive: only ever read inside the completion handlers.
	let sessionWasPersistedAtCompletionStart = false;

	$effect(() => {
		if (data.id !== session.id) handleSessionChange();
	});

	$effect(() => {
		const found = $settingsStore.models.find((m) => m.name === modelName);
		// A falsy `modelName` is a genuine clear — the combobox's Clear button
		// sets it to `undefined` — so write that through (disables Run). But a
		// NON-empty name that isn't in the list yet (e.g. `$settingsStore.models`
		// still loading, or a stale model whose server was removed) must NOT
		// clobber the model loadSession() restored — otherwise handleSessionChange
		// persists the null and the model name vanishes from the sidebar. With
		// `modelName` seeded from the session, the only `undefined` here is a real
		// clear, and a valid name resolves once the models list populates.
		if (!modelName || found) session.model = found;
	});

	$effect(() => {
		if (editor.shouldFocusTextarea && editor.promptTextarea) {
			editor.promptTextarea.focus();
			editor.shouldFocusTextarea = false;
		}
	});

	onMount(async () => {
		handleSessionChange();
		await scrollToBottom();
		messagesWindow?.addEventListener('scroll', handleScroll);
	});

	beforeNavigate((navigation) => {
		// Computed once up front because every branch below must respect it:
		// the session may already have been removed from the store (header
		// delete, sidebar single-delete, or multi-select batch delete) while
		// this page is still mounted. saveSession()'s upsert semantics would
		// otherwise resurrect a session the user just deleted, and the confirm
		// dialogs would prompt about a session that no longer exists.
		const sessionExists = get(sessionsStore).some((s) => s.id === session.id);

		if (editor.isCompletionInProgress) {
			// Silently abort (no prompt, no persist) ONLY when a session that was
			// persisted at completion start has since been deleted mid-stream —
			// persisting it would resurrect what the user just deleted. A
			// brand-new session that was never persisted is a normal in-progress
			// completion (not a resurrection), so it must still prompt before
			// leaving like any other; the earlier unconditional `!sessionExists`
			// check wrongly suppressed that prompt for every new session.
			if (sessionWasPersistedAtCompletionStart && !sessionExists) {
				editor.abortController?.abort();
				return;
			}
			const userConfirmed = confirm($LL.areYouSureYouWantToLeave());
			if (userConfirmed) {
				stopCompletion();
				return;
			}
			navigation.cancel();
			return;
		}

		// Persist per-session state only for a session that still exists — never
		// resurrect a deleted one through saveSession()'s upsert semantics.
		if (sessionExists && (session.messages.length > 0 || session.systemPromptText?.trim())) {
			saveSession(session);
		}

		// Warn about an unsaved prompt regardless of whether the session has been
		// persisted yet: a brand-new session with text typed but not sent still
		// has unsaved content worth protecting. Only when leaving the /sessions/
		// area — moving between sessions keeps the editor state.
		const hasUnsavedPrompt = editor.prompt && editor.prompt.trim() !== '';
		if (hasUnsavedPrompt && !navigation.to?.url.pathname.startsWith('/sessions/')) {
			const userConfirmed = confirm($LL.unsavedChangesWillBeLost());
			if (!userConfirmed) {
				navigation.cancel();
			}
		}
	});

	async function handleSessionChange() {
		const sessionExists = get(sessionsStore).some((s) => s.id === session.id);
		if (sessionExists && (session.messages.length > 0 || session.systemPromptText?.trim())) {
			saveSession(session);
		}
		session = loadSession(data.id);
		modelName = session.model?.name || '';
		editor.view = 'messages';
		editor.isNewSession = !session?.messages?.length;
		showSessionPrompt = false;
		isMessageSearchOpen = false;
		scrollToBottom();
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		// Only hijack Ctrl/Cmd+F where search is actually usable (canSearch:
		// messages view with ≥1 message) — the controls view has no messages
		// container, so opening the bar would give a non-functional, unbound box.
		if ((e.metaKey || e.ctrlKey) && e.key === 'f' && canSearch) {
			e.preventDefault();
			isMessageSearchOpen = true;
		}
	}

	async function handleSubmitNewMessage(images?: { data: string; filename: string }[]) {
		const message: Message = { role: 'user', content: editor.prompt };
		if (images && images.length) message.images = images;
		session.messages = [...session.messages, message];
		await scrollToBottom(true); // Force scroll after submitting prompt
		await handleCompletion(session.messages);
	}

	async function handleSubmitEditMessage(images?: { data: string; filename: string }[]) {
		if (editor.messageIndexToEdit === null) return;

		const msg = session.messages[editor.messageIndexToEdit];
		msg.content = editor.prompt;
		if (images) {
			msg.images = images;
		} else {
			delete msg.images;
		}

		// Remove all messages after the edited message
		session.messages = session.messages.slice(0, editor.messageIndexToEdit + 1);

		editor.messageIndexToEdit = null;
		editor.prompt = '';

		await handleCompletion(session.messages);
	}

	function handleSubmit(images?: { data: string; filename: string }[]) {
		if (!editor.prompt && (!images || images.length === 0)) return;
		if (!session.model) return;
		editor.isCodeEditor = false;
		editor.isNewSession = false;
		editor.view = 'messages';

		if (editor.messageIndexToEdit !== null) handleSubmitEditMessage(images);
		else handleSubmitNewMessage(images);
	}

	async function handleRetry(index: number) {
		// Remove all the messages after the index
		session.messages = session.messages.slice(0, index);

		const mostRecentUserMessage = session.messages.filter((m) => m.role === 'user').at(-1);
		if (!mostRecentUserMessage) throw new Error('No user message to retry');

		await handleCompletion(session.messages);
	}

	// Persist the result of a completion unless doing so would resurrect a
	// deleted session. A session that WAS in the store when the completion
	// began but has since been removed must not be re-inserted (the
	// resurrection bug); a brand-new session that was never persisted still
	// saves, because that is a create, not a resurrection.
	function persistCompletionResult() {
		const inStoreNow = get(sessionsStore).some((s) => s.id === session.id);
		const isResurrection = sessionWasPersistedAtCompletionStart && !inStoreNow;
		if (!isResurrection) saveSession(session);
	}

	async function handleCompletion(messages: Message[]) {
		editor.abortController = new AbortController();
		editor.isCompletionInProgress = true;
		// Snapshot store membership before streaming so persistCompletionResult()
		// can distinguish a first-save create from a mid-stream deletion.
		sessionWasPersistedAtCompletionStart = get(sessionsStore).some((s) => s.id === session.id);
		editor.prompt = '';
		editor.completion = '';
		editor.reasoning = '';

		try {
			// Resolve the target server + build the request INSIDE the try so a
			// removed/stale server (a session referencing a model whose server was
			// deleted) surfaces as a caught error → toast, instead of an unhandled
			// rejection that also leaves isCompletionInProgress stuck true.
			const server = $serversStore.find((s) => s.id === session.model?.serverId);
			if (!server) throw new Error('Server not found');
			if (!session.model?.name) throw new Error('No model');

			const systemMessages = buildSystemMessages(
				$settingsStore.globalSystemPrompt,
				session.systemPromptText,
				session.systemPrompt
			);
			const chatMessages = [...systemMessages, ...messages];
			const chatMessagesForRequest = chatMessages.map((msg) => ({
				role: msg.role,
				content: msg.content,
				images: msg.images?.map((img) => img.data),
				...(msg.role === 'assistant' && msg.reasoning && { reasoning_content: msg.reasoning })
			}));
			const chatRequest: ChatRequest = {
				model: session.model.name,
				options: session.options,
				messages: chatMessagesForRequest,
				...(session.reasoningEffort && { reasoningEffort: session.reasoningEffort })
			};

			let strategy: ChatStrategy | undefined = undefined;
			switch (server.connectionType) {
				case ConnectionType.Ollama:
					strategy = new OllamaStrategy(server);
					break;
				case ConnectionType.OpenAI:
				case ConnectionType.OpenAICompatible:
				case ConnectionType.LMStudio:
					strategy = new OpenAIStrategy(server);
					break;
			}

			if (!strategy) throw new Error('Invalid strategy');
			const activeStrategy = strategy;
			// Capture the signal in this narrowed scope (abortController was set at
			// the top of handleSubmit); both the initial and retry attempts share it.
			const abortSignal = editor.abortController.signal;

			// One streaming attempt: fresh reasoning-tag processor + clean editor
			// buffers so a retry starts from scratch.
			const streamOnce = async (request: ChatRequest) => {
				editor.completion = '';
				editor.reasoning = '';
				const reasoningProcessor = createReasoningProcessor(
					(text) => {
						editor.completion += text;
					},
					(text) => {
						editor.reasoning += text;
					}
				);
				await activeStrategy.chat(
					request,
					abortSignal,
					async (chunk) => {
						reasoningProcessor.processChunk(chunk);
						await scrollToBottom();
					},
					(reasoningChunk) => {
						editor.reasoning += reasoningChunk;
					}
				);
				// Finalize processing of any remaining content
				reasoningProcessor.finalize();
			};

			try {
				await streamOnce(chatRequest);
				// Dead-toggle detection: reasoning was requested but the model
				// produced NO trace at all — it silently ignored think/
				// reasoning_effort (the "lenient server" outcome the error-retry path
				// below can't catch, since there is no error). Tell the user. Wording
				// is soft ("may not support") because a capable model that simply
				// didn't reason on a trivial turn is the rare false positive — and the
				// notice is still accurate to the user's "I asked for reasoning and got
				// none" experience.
				if (chatRequest.reasoningEffort && !editor.reasoning) {
					toast.warning($LL.reasoningNotSupported());
				}
			} catch (error) {
				const e = error instanceof Error ? error : new Error(String(error));
				if (e.name === 'AbortError') throw e; // user abort — do not retry
				// Graceful degradation: the reasoning toggle is offered on every
				// endpoint, but most Ollama models reject `think:true` and some
				// OpenAI-compatible models reject `reasoning_effort`. If reasoning was
				// enabled and the request failed UPFRONT (nothing streamed yet), retry
				// once without the reasoning param so the user gets a response instead
				// of a scary error. If the retry also fails, the cause was unrelated
				// and its error surfaces via the outer catch. Not retrying once
				// content has streamed avoids mis-attributing a mid-stream failure.
				if (!chatRequest.reasoningEffort || editor.completion || editor.reasoning) throw e;
				const withoutReasoning: ChatRequest = { ...chatRequest };
				delete withoutReasoning.reasoningEffort;
				await streamOnce(withoutReasoning);
				toast.warning($LL.reasoningNotSupported());
			}

			const message: Message = {
				role: 'assistant',
				content: editor.completion,
				reasoning: editor.reasoning
			};

			session.messages = [...session.messages, message];
			session.updatedAt = new Date().toISOString();
			persistCompletionResult();

			editor.completion = '';
			editor.reasoning = '';
			editor.shouldFocusTextarea = true;
			editor.isCompletionInProgress = false;
			await scrollToBottom();
		} catch (error) {
			const typedError = error instanceof Error ? error : new Error(String(error));
			if (typedError.name === 'AbortError') return; // User aborted the request
			handleError(typedError);
		}
	}

	function stopCompletion() {
		editor.abortController?.abort();

		// Add the incomplete message to session if there's any content
		if (editor.completion || editor.reasoning) {
			const message: Message = {
				role: 'assistant',
				content: editor.completion || '',
				reasoning: editor.reasoning || ''
			};
			session.messages = [...session.messages, message];
			session.updatedAt = new Date().toISOString();
			persistCompletionResult();
		}

		// Clear editor state
		editor.completion = '';
		editor.reasoning = '';
		editor.isCompletionInProgress = false;
		editor.shouldFocusTextarea = true;
	}

	function handleError(error: Error) {
		if (error.message === 'Failed to fetch') {
			toast.error($LL.genericError(), { description: $LL.cantConnectToOllamaServer() });
		} else {
			toast.error($LL.genericError(), { description: error.toString() });
		}

		// For errors, restore the prompt so user can retry
		const lastUserMessage = session.messages.filter((m) => m.role === 'user').at(-1);
		if (lastUserMessage) {
			editor.prompt = lastUserMessage.content;
		}

		editor.abortController?.abort();
		editor.completion = '';
		editor.reasoning = '';
		editor.isCompletionInProgress = false;
		editor.shouldFocusTextarea = true;
	}

	function handleScroll() {
		if (!messagesWindow) return;
		const { scrollTop, scrollHeight, clientHeight } = messagesWindow;
		userScrolledUp = scrollTop + clientHeight < scrollHeight;
	}

	async function scrollToBottom(shouldForceScroll = false) {
		if (!shouldForceScroll && (!messagesWindow || userScrolledUp)) return;
		await tick();
		requestAnimationFrame(() => {
			if (messagesWindow) messagesWindow.scrollTop = messagesWindow.scrollHeight;
		});
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="session">
	<Head
		title={[editor.isNewSession ? $LL.newSession() : getSessionTitle(session), $LL.sessions()]}
	/>
	<Header confirmDeletion={shouldConfirmDeletion}>
		{#snippet headline()}
			<p data-testid="session-id" class="font-bold leading-none">
				{$LL.session()}
				<Button variant="link" href={`/sessions/${session.id}`}>#{session.id}</Button>
			</p>
			<Metadata dataTestid="session-metadata">
				{editor.isNewSession ? $LL.newSession() : formatSessionMetadata(session)}
			</Metadata>
		{/snippet}

		{#snippet nav()}
			<button
				bind:this={systemPromptButton}
				class="base-button base-button--icon"
				aria-label={$LL.sessionSystemPrompt()}
				aria-expanded={showSessionPrompt}
				aria-controls="session-system-prompt-panel"
				data-testid="session-system-prompt-button"
				onclick={() => {
					showSessionPrompt = !showSessionPrompt;
					if (showSessionPrompt) {
						tick().then(() => {
							const textarea = document.getElementById('session-system-prompt-textarea');
							if (textarea) textarea.focus();
						});
					}
				}}
			>
				{#if session.systemPromptText?.trim()}
					<NotebookPen class="base-icon" />
				{:else}
					<FileText class="base-icon" />
				{/if}
			</button>
			<!-- Copy/export is provider- AND view-independent — always shown (except
				during delete confirmation). Search is provider-independent too, but only
				rendered where it can actually work (canSearch: messages view with ≥1
				message); the controls view has no messages container and an empty chat
				has nothing to find. Neither is gated on the connection type — the "only
				shows for Fireworks" report was the empty-session state, not a provider
				gate. -->
			{#if !shouldConfirmDeletion}
				{#if canSearch}
					<button
						class="base-button base-button--icon"
						aria-label={$LL.searchInConversation()}
						aria-expanded={isMessageSearchOpen}
						data-testid="session-search-toggle"
						onclick={() => (isMessageSearchOpen = !isMessageSearchOpen)}
					>
						<Search class="base-icon" />
					</button>
				{/if}
				<SessionExportMenu {session} />
			{/if}
			{#if !editor.isNewSession}
				<ButtonDelete sitemap={Sitemap.SESSIONS} id={session.id} bind:shouldConfirmDeletion />
			{/if}
		{/snippet}
	</Header>

	{#if showSessionPrompt}
		<div
			id="session-system-prompt-panel"
			class="session__system-prompt"
			transition:slide={{ duration: 150 }}
		>
			<label for="session-system-prompt-textarea" class="text-xs font-medium text-muted">
				{$LL.sessionSystemPrompt()}
			</label>
			<textarea
				id="session-system-prompt-textarea"
				aria-label={$LL.systemPromptInstructions()}
				class="session__system-prompt-textarea"
				placeholder={$LL.systemPromptPlaceholder()}
				maxlength={10000}
				value={session.systemPromptText ?? ''}
				oninput={(e) => (session.systemPromptText = e.currentTarget.value)}
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						showSessionPrompt = false;
						systemPromptButton?.focus();
					}
				}}
			></textarea>
			{#if $settingsStore.globalSystemPrompt?.trim()}
				<p class="text-xs text-muted">{$LL.systemPromptMultipleNote()}</p>
			{/if}
		</div>
	{/if}

	{#if isMessageSearchOpen}
		<InConversationSearch
			messages={session.messages}
			containerEl={messagesWindow}
			onClose={() => (isMessageSearchOpen = false)}
		/>
	{/if}

	{#if editor.view === 'controls'}
		<Controls bind:session />
	{:else}
		<div class="session__history" bind:this={messagesWindow}>
			<Messages bind:session bind:editor {handleRetry} />
		</div>
	{/if}

	<Prompt
		bind:session
		bind:editor
		bind:modelName
		{handleSubmit}
		{stopCompletion}
		{scrollToBottom}
	/>
</div>

<style lang="postcss">
	.session {
		@apply flex h-full w-full flex-col overflow-hidden;
	}

	.session__history {
		@apply base-fieldset-container overflow-scrollbar flex-grow;
	}

	.session__system-prompt {
		@apply flex flex-col gap-y-1 border-b bg-shade-1 px-4 py-3;
	}

	.session__system-prompt-textarea {
		@apply base-input min-h-20 resize-y rounded-md border bg-shade-0 px-3 py-2 text-sm;
		@apply focus:border-shade-6 focus:outline focus:outline-shade-2;
		field-sizing: content;
	}
</style>
