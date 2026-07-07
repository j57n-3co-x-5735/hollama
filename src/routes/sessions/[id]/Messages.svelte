<script lang="ts">
	import { get } from 'svelte/store';

	import LL from '$i18n/i18n-svelte';
	import EmptyMessage from '$lib/components/EmptyMessage.svelte';
	import { sessionsStore } from '$lib/localStorage';
	import { saveSession, type Editor, type Message, type Session } from '$lib/sessions';

	import Article from './Article.svelte';

	interface Props {
		session: Session;
		editor: Editor;
		handleRetry: (index: number) => void;
	}

	let { session = $bindable(), editor = $bindable(), handleRetry }: Props = $props();

	function handleEditMessage(message: Message) {
		editor.messageIndexToEdit = session.messages.findIndex((m) => m === message);
		editor.isCodeEditor = true;
		editor.prompt = message.content;
		editor.attachments = (message.images || []).map((img, idx) => ({
			type: 'image',
			id: `${idx}-${img.filename}`,
			name: img.filename,
			dataUrl: `data:image/png;base64,${img.data}`
		}));
		editor.promptTextarea?.focus();
	}

	function handleDeleteAttachment(message: Message) {
		session.messages = session.messages.filter((m) => m !== message);
		// Only persist if the session still exists in the store — if it was
		// deleted (e.g. via multi-select) while being viewed, saveSession()'s
		// upsert would otherwise resurrect it.
		if (get(sessionsStore).some((s) => s.id === session.id)) {
			saveSession(session);
		}
	}
</script>

<!-- Show the empty-state whenever there are no messages — NOT only when
	isNewSession is true. An existing session whose messages were all removed in
	place (e.g. deleting its last attachment) has isNewSession=false but zero
	messages; keying only on isNewSession rendered a blank void instead. -->
{#if session.messages.length === 0 && !editor.isCompletionInProgress}
	<EmptyMessage>{$LL.writePromptToStart()}</EmptyMessage>
{/if}

{#each session.messages as message, i (session.id + i)}
	{#key message.role}
		<Article
			{message}
			retryIndex={['assistant', 'system'].includes(message.role) ? i : undefined}
			{handleRetry}
			handleEditMessage={() => handleEditMessage(message)}
			handleDeleteAttachment={() => handleDeleteAttachment(message)}
		/>
	{/key}
{/each}

{#if editor.isCompletionInProgress}
	<Article
		message={{
			role: 'assistant',
			content: editor.completion || '...',
			reasoning: editor.reasoning
		}}
		isStreamingArticle={true}
		currentRawReasoning={editor.reasoning}
		currentRawCompletion={editor.completion}
	/>
{/if}
