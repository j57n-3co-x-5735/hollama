import { toast } from 'svelte-sonner';
import { get } from 'svelte/store';

import LL from '$i18n/i18n-svelte';
import type { OllamaOptions } from '$lib/chat/ollama';
import { sessionsStore, settingsStore, sortStore } from '$lib/localStorage';
import { checkStorageCapacity, formatBytes, STORAGE_LIMIT_BYTES } from '$lib/storage';

import { getLastUsedModels } from './chat';
import type { Knowledge } from './knowledge';
import type { Model } from './settings';
import { formatTimestampToNow } from './utils';

export interface Message {
	role: 'user' | 'assistant' | 'system';
	content: string;
	knowledge?: Knowledge;
	context?: number[];
	reasoning?: string;
	images?: { data: string; filename: string }[]; // Store image data and filename
}

export interface Session {
	id: string;
	messages: Message[];
	systemPrompt: Message;
	systemPromptText?: string;
	options: Partial<OllamaOptions>;
	model?: Model;
	updatedAt?: string;
	title?: string;
	reasoningEffort?: string;
	folderId?: string;
}

export interface Editor {
	prompt: string;
	view: 'messages' | 'controls';
	messageIndexToEdit: number | null;
	isCodeEditor: boolean;
	isCompletionInProgress: boolean;
	isNewSession: boolean;
	shouldFocusTextarea: boolean;
	attachments?: { type: 'image'; id: string; name: string; dataUrl: string }[];
	completion?: string;
	reasoning?: string;
	promptTextarea?: HTMLTextAreaElement;
	abortController?: AbortController;
}

export const loadSession = (id: string): Session => {
	let session: Session | null = null;

	// Retrieve the current sessions
	const currentSessions = get(sessionsStore);

	const defaultSystemPrompt: Message = {
		role: 'system',
		content: ''
	};

	// Find the session with the given id
	if (currentSessions) {
		const existingSession = currentSessions.find((s) => s.id === id);
		if (existingSession) {
			session = {
				...existingSession,
				// NOTE: `options` and `systemPrompt` are required fields but `existingSessions`
				// created before this feature was implemented need to be set to the defaults.
				// Over time we can probably remove them.
				options: existingSession.options || {},
				systemPrompt: existingSession.systemPrompt || defaultSystemPrompt,
				systemPromptText: existingSession.systemPromptText || ''
			};
		}
	}

	if (!session) {
		// Use the last used model
		const model = getLastUsedModels()[0];

		// Create a new session
		session = {
			id,
			model,
			systemPrompt: defaultSystemPrompt,
			systemPromptText: '',
			updatedAt: new Date().toISOString(),
			messages: [],
			options: {}
		};
	}

	return session;
};

export const saveSession = (session: Session): void => {
	// Retrieve the current sessions
	const currentSessions = get(sessionsStore) || [];

	// Find the index of the session with the same id, if it exists
	const existingIndex = currentSessions.findIndex((k) => k.id === session.id);

	const { usedBytes, shouldWarn, shouldBlock } = checkStorageCapacity();

	if (existingIndex !== -1) {
		// Update the existing session
		currentSessions[existingIndex] = session;
	} else {
		// New sessions are what actually grow storage usage, so the block
		// threshold only stops session creation — updating an existing
		// session (e.g. appending a message) is never blocked, or a user
		// could get trapped mid-conversation right at the ceiling.
		if (shouldBlock) {
			const ll = get(LL);
			toast.error(
				ll.storageFull({
					used: formatBytes(usedBytes),
					total: formatBytes(STORAGE_LIMIT_BYTES)
				}),
				{ id: 'storage-block-toast' }
			);
			return;
		}
		currentSessions.push(session);
	}

	if (shouldWarn) {
		toast.warning(get(LL).storageFillingUp(), { id: 'storage-warning-toast' });
	}

	// Sort the sessions by updatedAt in descending order (most recent first)
	const sortedSessions = sortStore(currentSessions);

	// Update the store with the sorted sessions
	sessionsStore.set(sortedSessions);

	// Update the last used models
	const lastUsedModels = getLastUsedModels();
	settingsStore.update((settings) => ({ ...settings, lastUsedModels }));
};

export function formatSessionMetadata(session: Session) {
	const subtitles: string[] = [];
	if (session.updatedAt) subtitles.push(formatTimestampToNow(session.updatedAt));
	if (session.model) subtitles.push(session.model.name);
	return subtitles.join(' • ');
}

export function buildSystemMessages(
	globalPrompt: string | undefined,
	sessionPromptText: string | undefined,
	knowledgePrompt: Message | undefined
): Message[] {
	const messages: Message[] = [];
	const trimmedGlobal = globalPrompt?.trim();
	if (trimmedGlobal) {
		messages.push({ role: 'system', content: trimmedGlobal });
	}
	const trimmedSession = sessionPromptText?.trim();
	if (trimmedSession) {
		messages.push({ role: 'system', content: trimmedSession });
	}
	if (knowledgePrompt?.content) {
		messages.push(knowledgePrompt);
	}
	return messages;
}

export function getSessionTitle(session: Session) {
	if (session.title) return session.title;

	const firstUserMessage = session.messages.find(
		(m) => m.role === 'user' && m.content && !m.knowledge
	);

	if (firstUserMessage?.content) {
		const MAX_TITLE_LENGTH = 56;
		return firstUserMessage.content.slice(0, MAX_TITLE_LENGTH);
	}

	return '';
}

/** Renders a session as clean, shareable Markdown — the human-readable
 * counterpart to the raw JSON copy. Conversation only: system prompts and the
 * injected knowledge/file `<CONTEXT>` blocks are infrastructure, not dialogue,
 * and are omitted (see the LM-Studio paradigm); reasoning traces are omitted
 * too. Roles become `## You` / `## Assistant` headings. */
export function formatSessionAsMarkdown(session: Session): string {
	const lines: string[] = [];

	// Title: the explicit title, else the first *real* user message — skipping
	// injected <CONTEXT> blocks and knowledge attachments, which getSessionTitle
	// doesn't, so a file-attached session isn't titled with its context dump.
	const firstUserMessage = session.messages.find(
		(m) =>
			m.role === 'user' &&
			!m.knowledge &&
			!!m.content?.trim() &&
			!m.content.trim().startsWith('<CONTEXT>')
	);
	const title = session.title || firstUserMessage?.content?.trim().slice(0, 56) || '';
	if (title) lines.push(`# ${title}`, '');

	for (const message of session.messages) {
		if (message.role === 'system') continue; // infrastructure, not conversation
		if (message.knowledge) continue; // injected knowledge attachment

		const content = message.content?.trim() ?? '';
		const isContextInjection = content.startsWith('<CONTEXT>'); // injected file attachment

		if (content && !isContextInjection) {
			lines.push(message.role === 'user' ? '## You' : '## Assistant', '', content, '');
		}

		if (message.images?.length) {
			for (const image of message.images) lines.push(`_[image: ${image.filename}]_`, '');
		}
	}

	return lines.join('\n').trim() + '\n';
}
