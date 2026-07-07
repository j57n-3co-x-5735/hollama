<script lang="ts">
	import {
		Brain,
		CircleStop,
		FolderOpen,
		Image,
		LoaderCircle,
		Pin,
		Sparkles,
		UnfoldVertical
	} from 'lucide-svelte';
	import MessageSquareText from 'lucide-svelte/icons/message-square-text';
	import Settings_2 from 'lucide-svelte/icons/settings-2';
	import Trash_2 from 'lucide-svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';

	import LL from '$i18n/i18n-svelte';
	import Button from '$lib/components/Button.svelte';
	import ButtonSubmit from '$lib/components/ButtonSubmit.svelte';
	import Field from '$lib/components/Field.svelte';
	import FieldSelectModel from '$lib/components/FieldSelectModel.svelte';
	import FieldTextEditor from '$lib/components/FieldTextEditor.svelte';
	import FileBrowser from '$lib/components/FileBrowser.svelte';
	import { ConnectionType } from '$lib/connections';
	import {
		addFileReference,
		fileContentQuery,
		removeFileReference,
		togglePersistence,
		type FileReference
	} from '$lib/files';
	import { loadKnowledge, type Knowledge } from '$lib/knowledge';
	import { filesStore, knowledgeStore, serversStore } from '$lib/localStorage';
	import type { Editor, Message, Session } from '$lib/sessions';
	import { generateRandomId } from '$lib/utils';

	import AttachmentImage from './AttachmentImage.svelte';
	import KnowledgeSelect from './KnowledgeSelect.svelte';

	type KnowledgeAttachment = {
		type: 'knowledge';
		fieldId: string;
		knowledge?: Knowledge;
	};

	type ImageAttachment = {
		type: 'image';
		id: string;
		name: string;
		dataUrl: string;
	};

	type Attachment = KnowledgeAttachment | ImageAttachment;

	// File attachments are deliberately NOT part of the `attachments` array
	// above. `filesStore` (localStorage-backed, see $lib/files.ts) is already
	// the durable source of truth for "currently selected files" — a
	// persistent file must survive `submit()`'s end-of-send attachment reset,
	// and re-deriving that from a plain in-memory array would either
	// duplicate state or need a bespoke reset exception. Reading the store
	// directly at send time and rendering it as its own section below keeps
	// one source of truth instead of two that could drift.
	let isFileBrowserOpen = $state(false);

	interface Props {
		editor: Editor;
		session: Session;
		modelName: string | undefined;
		handleSubmit: (images?: { data: string; filename: string }[]) => void;
		stopCompletion: () => void;
		scrollToBottom: (shouldForceScroll: boolean) => void;
	}

	let {
		editor = $bindable(),
		session = $bindable(),
		modelName = $bindable(),
		handleSubmit,
		stopCompletion,
		scrollToBottom
	}: Props = $props();

	let attachments: Attachment[] = $state([]);

	const currentServer = $derived(
		$serversStore.find((s) => s.id === session.model?.serverId)
	);

	const isOllamaFamily = $derived(
		currentServer?.connectionType === ConnectionType.Ollama
	);

	function toggleReasoning() {
		session.reasoningEffort = session.reasoningEffort ? undefined : 'high';
	}

	$effect(() => {
		if (attachments.length) scrollToBottom(true);
	});

	$effect(() => {
		if (editor.messageIndexToEdit !== null && editor.attachments) {
			attachments = [...editor.attachments];
		}
	});

	function toggleCodeEditor() {
		editor.isCodeEditor = !editor.isCodeEditor;
		editor.shouldFocusTextarea = !editor.isCodeEditor;
	}

	function switchToMessages() {
		editor.view = 'messages';
		scrollToBottom(true);
	}

	function switchToControls() {
		if (!isOllamaFamily) {
			toast.warning($LL.controlsOnlyAvailableForOllama());
			return;
		}
		editor.view = 'controls';
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.shiftKey) return;
		if (event.key !== 'Enter') return;
		event.preventDefault();
		submit();
	}

	function handlePaste(event: ClipboardEvent) {
		const clipboardData = event.clipboardData;
		if (!clipboardData) return;

		const items = Array.from(clipboardData.items);
		const imageItems = items.filter((item) => item.type.startsWith('image/'));

		if (imageItems.length === 0) return;

		// Prevent default paste behavior when images are detected
		event.preventDefault();

		const allowedTypes = ['image/png', 'image/jpeg'];
		const newAttachments: ImageAttachment[] = [];
		let unsupportedFiles = false;

		const imagePromises = imageItems.map((item, index) => {
			return new Promise<void>((resolve) => {
				if (!allowedTypes.includes(item.type)) {
					unsupportedFiles = true;
					resolve();
					return;
				}

				const file = item.getAsFile();
				if (!file) {
					resolve();
					return;
				}

				const reader = new FileReader();
				reader.onload = (event) => {
					const dataUrl = event.target?.result as string;
					if (dataUrl) {
						// Generate a filename based on timestamp and index
						const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
						const extension = item.type === 'image/png' ? 'png' : 'jpg';
						const filename = `pasted-image-${timestamp}-${index + 1}.${extension}`;

						newAttachments.push({
							type: 'image',
							id: generateRandomId(),
							name: filename,
							dataUrl
						});
					}
					resolve();
				};
				reader.onerror = () => {
					console.error('Error reading pasted image');
					resolve();
				};
				reader.readAsDataURL(file);
			});
		});

		Promise.all(imagePromises).then(() => {
			if (unsupportedFiles) {
				toast.warning('Some images were ignored. Only PNG and JPEG images are supported.');
			}
			if (newAttachments.length > 0) {
				attachments = [...attachments, ...newAttachments];
			}
		});
	}

	function handleSelectKnowledge(fieldId: string, knowledgeId: string) {
		attachments = attachments.map((a) =>
			a.type === 'knowledge' && a.fieldId === fieldId
				? { ...a, knowledge: loadKnowledge(knowledgeId) }
				: a
		);
	}

	function handleImageUploadClick() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.png,.jpg,.jpeg,image/png,image/jpeg';
		input.multiple = true;
		input.onchange = (e) => {
			const files = (e.target as HTMLInputElement).files;
			if (!files || files.length === 0) return;

			const allowedTypes = ['image/png', 'image/jpeg'];
			const newAttachments: Attachment[] = [];
			let unsupportedFiles = false;

			const filePromises = Array.from(files).map((file) => {
				return new Promise<void>((resolve) => {
					if (!allowedTypes.includes(file.type)) {
						unsupportedFiles = true;
						resolve();
						return;
					}

					const reader = new FileReader();
					reader.onload = (event) => {
						const dataUrl = event.target?.result as string;
						if (dataUrl) {
							newAttachments.push({
								type: 'image',
								id: generateRandomId(),
								name: file.name,
								dataUrl
							});
						}
						resolve();
					};
					reader.onerror = () => {
						console.error('Error reading file:', file.name);
						resolve();
					};
					reader.readAsDataURL(file);
				});
			});

			Promise.all(filePromises).then(() => {
				if (unsupportedFiles) {
					toast.warning('Some files were ignored. Only PNG and JPEG images are supported.');
				}
				if (newAttachments.length > 0) {
					attachments = [...attachments, ...newAttachments];
				}
			});
		};
		input.click();
	}

	function handleDeleteAttachment(id: string) {
		attachments = [
			...attachments.filter((a) => (a.type === 'knowledge' ? a.fieldId : a.id) !== id)
		];
	}

	async function fetchFileContent(file: FileReference): Promise<string> {
		const response = await fetch(`/api/files/content?${fileContentQuery(file)}`);
		if (!response.ok) {
			let reason = response.statusText || `HTTP ${response.status}`;
			try {
				const body = await response.json();
				if (body?.error) reason = body.error;
			} catch {
				// Non-JSON error body — keep the statusText-derived reason.
			}
			throw new Error(reason);
		}
		return response.text();
	}

	async function submit() {
		const knowledgeAttachments = attachments.filter(
			(a): a is KnowledgeAttachment => a.type === 'knowledge'
		);
		if (knowledgeAttachments.length) {
			const knowledgeAttachmentMessages: Message[] = [];
			attachments.forEach((a) => {
				if (a.type === 'knowledge' && a.knowledge)
					knowledgeAttachmentMessages.push({
						role: 'user',
						knowledge: a.knowledge,
						content: `
<CONTEXT>
	<CONTEXT_NAME>${a.knowledge.name}</CONTEXT_NAME>
	<CONTEXT_CONTENT>${a.knowledge.content}</CONTEXT_CONTENT>
</CONTEXT>
`
					});
			});
			session.messages = [...session.messages, ...knowledgeAttachmentMessages];
			attachments = attachments.filter((a) => a.type !== 'knowledge');
		}

		// File attachments are read fresh from disk at send time (not cached
		// from selection time) and injected as a separate block after
		// knowledge, before the user's own message.
		const currentFiles = $filesStore;
		if (currentFiles.length) {
			const fileAttachmentMessages: Message[] = [];
			for (const file of currentFiles) {
				try {
					const content = await fetchFileContent(file);
					fileAttachmentMessages.push({
						role: 'user',
						content: `
<CONTEXT>
	<CONTEXT_NAME>${file.name}</CONTEXT_NAME>
	<CONTEXT_CONTENT>${content}</CONTEXT_CONTENT>
</CONTEXT>
`
					});
					// One-off files are consumed on send; persistent ones stay
					// selected until the user removes them.
					if (!file.persistentlySelected) removeFileReference(file.id);
				} catch (error) {
					const reason = error instanceof Error ? error.message : 'Unknown error';
					toast.error($LL.couldNotAttachFile({ name: file.name }), { description: reason });
					// Don't let a broken reference silently fail on every future
					// send — drop it regardless of persistent/one-off.
					removeFileReference(file.id);
				}
			}
			if (fileAttachmentMessages.length) {
				session.messages = [...session.messages, ...fileAttachmentMessages];
			}
		}

		const imageAttachments = attachments.filter((a): a is ImageAttachment => a.type === 'image');
		const imagesPayload = imageAttachments.map((a) => ({
			filename: a.name,
			data: a.dataUrl.replace(/^data:image\/[a-zA-Z]+;base64,/, '')
		}));

		handleSubmit(imagesPayload.length ? imagesPayload : undefined);
		attachments = [];
	}

	function handleBrowseFilesSelect(
		rootIndex: number,
		rel: string,
		name: string,
		persistent: boolean
	) {
		addFileReference(rootIndex, rel, name, persistent);
		toast.success(
			persistent
				? $LL.fileAttachedPersistently({ name })
				: $LL.fileAttachedOnce({ name })
		);
	}
</script>

<div class="prompt-editor {editor.isCodeEditor ? 'prompt-editor--fullscreen' : ''}">
	<div class="prompt-editor__form">
		<div class="prompt-editor__project">
			<FieldSelectModel isLabelVisible={false} bind:value={modelName} />

			<nav class="segmented-nav">
				<div
					class="segmented-nav__button {editor.view === 'messages'
						? 'segmented-nav__button--active'
						: ''}"
				>
					<Button
						aria-label={$LL.messages()}
						variant="icon"
						onclick={switchToMessages}
						class="h-full"
						isActive={editor.view === 'messages'}
					>
						<MessageSquareText class="base-icon" />
					</Button>
				</div>
				<div
					class="segmented-nav__button {editor.view === 'controls'
						? 'segmented-nav__button--active'
						: ''}"
				>
					<Button
						aria-label={$LL.controls()}
						variant="icon"
						onclick={switchToControls}
						class="h-full"
						isActive={editor.view === 'controls'}
					>
						<Settings_2 class="base-icon" />
					</Button>
				</div>
			</nav>

			<Button
				variant={editor.isCodeEditor ? 'default' : 'outline'}
				class="prompt-editor__toggle"
				onclick={toggleCodeEditor}
			>
				<UnfoldVertical class="base-icon" />
			</Button>
		</div>

		{#if editor.isCodeEditor}
			<FieldTextEditor label={$LL.prompt()} handleSubmit={submit} bind:value={editor.prompt} />
		{:else}
			<Field name="prompt">
				<textarea
					name="prompt"
					class="prompt-editor__textarea"
					placeholder={$LL.promptPlaceholder()}
					bind:this={editor.promptTextarea}
					bind:value={editor.prompt}
					onkeydown={handleKeyDown}
					onpaste={handlePaste}
				></textarea>
			</Field>
		{/if}

		{#if attachments.length}
			<div class="attachments">
				{#each attachments as attachment (attachment.type === 'knowledge' ? attachment.fieldId : attachment.id)}
					<div class="attachment">
						{#if attachment.type === 'knowledge'}
							<div class="attachment__knowledge">
								<KnowledgeSelect
									value={attachment.knowledge?.id}
									options={$knowledgeStore?.filter(
										(k) =>
											// Only filter out knowledge that's selected in OTHER attachments
											!attachments.find((a) => {
												if (a.type !== 'knowledge' || attachment.type !== 'knowledge') return false;
												return a.fieldId !== attachment.fieldId && a.knowledge?.id === k.id;
											})
									)}
									showLabel={false}
									fieldId={`attachment-${attachment.fieldId}`}
									onChange={(knowledgeId) =>
										knowledgeId && handleSelectKnowledge(attachment.fieldId, knowledgeId)}
									allowClear={false}
								/>
							</div>
						{:else if attachment.type === 'image'}
							<AttachmentImage dataUrl={attachment.dataUrl} name={attachment.name} />
						{/if}
						<Button
							variant="outline"
							onclick={() =>
								handleDeleteAttachment(
									attachment.type === 'knowledge' ? attachment.fieldId : attachment.id
								)}
							data-testid="attachment-delete"
						>
							<Trash_2 class="base-icon" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}

		{#if $filesStore.length}
			<div class="attachments" data-testid="file-attachments">
				{#each $filesStore as file (file.id)}
					<div class="attachment">
						<button
							type="button"
							class="file-badge"
							class:file-badge--persistent={file.persistentlySelected}
							onclick={() => togglePersistence(file.id)}
							title={file.persistentlySelected ? $LL.persistentFileIndicator() : $LL.attachOnce()}
							data-testid="file-attachment-badge"
						>
							{#if file.persistentlySelected}
								<Pin class="base-icon" />
							{/if}
							<span class="file-badge__name">{file.name}</span>
						</button>
						<Button
							variant="outline"
							onclick={() => removeFileReference(file.id)}
							aria-label={$LL.removeFile()}
							data-testid="file-attachment-remove"
						>
							<Trash_2 class="base-icon" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}

		<nav class="prompt-editor__toolbar">
			<div class="attachments-toolbar">
				<Button
					variant="outline"
					onclick={() => {
						attachments = [...attachments, { type: 'knowledge', fieldId: generateRandomId() }];
					}}
					data-testid="knowledge-attachment"
				>
					<Brain class="base-icon" />
				</Button>
				<Button
					variant="outline"
					onclick={handleImageUploadClick}
					data-testid="image-attachment"
					title={$LL.attachImage()}
				>
					<Image class="base-icon" />
				</Button>
				<Button
					variant="outline"
					onclick={() => (isFileBrowserOpen = true)}
					data-testid="browse-files"
					title={$LL.browseFiles()}
				>
					<FolderOpen class="base-icon" />
				</Button>
				<Button
					variant={session.reasoningEffort ? 'default' : 'outline'}
					onclick={toggleReasoning}
					data-testid="reasoning-toggle"
					title={$LL.enableReasoning()}
				>
					<Sparkles class="base-icon" />
				</Button>
			</div>

			<div class="prompt-editor__submit">
				{#if editor.messageIndexToEdit !== null}
					<Button
						class="h-full"
						variant="outline"
						onclick={() => {
							editor.prompt = '';
							editor.messageIndexToEdit = null;
							editor.isCodeEditor = false;
						}}
					>
						{$LL.cancel()}
					</Button>
				{/if}

				<ButtonSubmit
					handleSubmit={submit}
					hasMetaKey={editor.isCodeEditor}
					disabled={(!editor.prompt && !attachments.filter((a) => a.type === 'image').length) ||
						!session.model ||
						editor.isCompletionInProgress}
				>
					{$LL.run()}
				</ButtonSubmit>

				{#if editor.isCompletionInProgress}
					<Button
						class="h-full"
						title={$LL.stopCompletion()}
						variant="outline"
						onclick={stopCompletion}
					>
						<div class="prompt-editor__stop">
							<span class="prompt-editor__stop-icon">
								<CircleStop class=" base-icon" />
							</span>
							<span class="prompt-editor__loading-icon">
								<LoaderCircle class="prompt-editor__loading-icon base-icon animate-spin" />
							</span>
						</div>
					</Button>
				{/if}
			</div>
		</nav>
	</div>
</div>

{#if isFileBrowserOpen}
	<FileBrowser onClose={() => (isFileBrowserOpen = false)} onSelectFile={handleBrowseFilesSelect} />
{/if}

<style lang="postcss">
	.prompt-editor {
		@apply sticky bottom-0 z-10 mx-auto flex w-full flex-col border-t bg-shade-1 p-3;
		@apply md:p-4;
		@apply lg:p-6;
		@apply 2xl:max-w-[80ch] 2xl:rounded-t-lg 2xl:border-l 2xl:border-r;
	}

	.prompt-editor__project {
		@apply grid grid-cols-[auto,max-content,max-content] items-end gap-x-2;
	}

	:global(.prompt-editor__toggle) {
		@apply h-full;
	}

	.prompt-editor--fullscreen {
		@apply min-h-[60dvh];
		@apply md:min-h-[75dvh];
	}

	.prompt-editor__form {
		@apply flex h-full min-h-0 flex-col gap-y-2;
	}

	.prompt-editor__textarea {
		@apply base-input max-h-48 min-h-14 resize-none scroll-p-2 px-3 py-2;
		field-sizing: content;
		font-variant-ligatures: none;
	}

	.prompt-editor__toolbar {
		@apply flex items-center justify-between gap-x-2;
	}

	.prompt-editor__stop {
		@apply relative -mx-3 -my-2 h-9 w-9;
	}

	.prompt-editor__stop:hover {
		.prompt-editor__stop-icon {
			@apply opacity-100;
		}

		.prompt-editor__loading-icon {
			@apply opacity-0;
		}
	}

	.prompt-editor__submit {
		@apply flex h-full items-center gap-x-2;
	}

	.prompt-editor__stop-icon,
	.prompt-editor__loading-icon {
		@apply absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2;
	}

	.prompt-editor__stop-icon {
		@apply opacity-0;
	}

	.prompt-editor__loading-icon {
		@apply opacity-100;
	}

	.segmented-nav {
		@apply flex h-full items-center rounded bg-shade-2 p-0.5;
	}

	.segmented-nav__button {
		@apply h-full rounded-sm text-shade-6;

		&--active {
			@apply bg-shade-0 text-neutral-50 shadow;
		}
	}

	.attachments-toolbar {
		@apply flex h-full gap-x-1;
	}

	.attachments {
		@apply overflow-scrollbar flex max-h-48 flex-col gap-y-1;
	}

	.attachment {
		@apply flex w-full justify-between;
	}

	.attachment__knowledge {
		@apply w-full;
	}

	.file-badge {
		@apply base-input flex w-full items-center gap-2 truncate px-3 py-2 text-left text-sm;
	}

	.file-badge--persistent {
		@apply text-accent;
	}

	.file-badge__name {
		@apply truncate;
	}
</style>
