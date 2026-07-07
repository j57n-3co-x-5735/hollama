<script lang="ts">
	import { ChevronRight, Trash2 } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import { deleteFolder, renameFolder, setFolderExpanded, type Folder } from '$lib/folders';
	import { formatSessionMetadata, getSessionTitle, type Session } from '$lib/sessions';

	import Button from './Button.svelte';
	import ButtonEdit from './ButtonEdit.svelte';
	import Metadata from './Metadata.svelte';
	import SidebarSessionItem from './SidebarSessionItem.svelte';

	interface Props {
		folder: Folder;
		sessions: Session[];
		isDragOver: boolean;
		onDragEnter: () => void;
		onDragLeave: () => void;
		onDropSession: (sessionId: string) => void;
		isMultiSelectMode?: boolean;
		selectedIds?: Set<string>;
		onToggleSelect?: (id: string, event: MouseEvent) => void;
	}

	let {
		folder,
		sessions,
		isDragOver,
		onDragEnter,
		onDragLeave,
		onDropSession,
		isMultiSelectMode = false,
		selectedIds,
		onToggleSelect
	}: Props = $props();
	let isEditing = $state(false);
	let editedName = $state(folder.name);
	let nameInput: HTMLInputElement | null = $state(null);
	let isDeleting = $state(false);

	$effect(() => {
		if (isEditing && nameInput) nameInput.focus();
	});

	function toggleExpanded() {
		setFolderExpanded(folder.id, !folder.isExpanded);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		onDragEnter();
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const sessionId = e.dataTransfer?.getData('text/plain');
		if (sessionId) onDropSession(sessionId);
	}

	function handleRename() {
		const trimmed = editedName.trim();
		if (trimmed && trimmed !== folder.name) {
			renameFolder(folder.id, trimmed);
		}
		isEditing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleRename();
		// Escape cancels the rename from the keyboard — matches the mouse path
		// (the ButtonEdit X) so keyboard-only users aren't stranded mid-edit.
		else if (e.key === 'Escape') cancelEdit();
	}

	function cancelEdit() {
		editedName = folder.name;
		isEditing = false;
	}
</script>

<div
	class="sidebar-folder"
	class:sidebar-folder--editing={isEditing}
	class:sidebar-folder--drag-over={isDragOver}
	data-testid="folder-item"
	role="group"
	aria-label={folder.name}
	ondragover={handleDragOver}
	ondragleave={onDragLeave}
	ondrop={handleDrop}
>
	<div class="sidebar-folder__header">
		{#if isEditing}
			<div class="sidebar-folder__content">
				<input
					bind:this={nameInput}
					bind:value={editedName}
					class="sidebar-folder__title-input"
					type="text"
					aria-label={$LL.folderName()}
					onkeydown={handleKeydown}
				/>
				<Metadata>{$LL.editTitle()}</Metadata>
			</div>
		{:else}
			<div class="sidebar-folder__toggle-row">
				<!-- Both the chevron and the folder name toggle expand/collapse.
					Renaming is reached ONLY via the pencil (ButtonEdit, hover-revealed
					in the actions nav) — clicking the title must not rename. The chevron
					remains the primary state-announcing disclosure control; the name
					button is a larger click target that toggles the same state. -->
				<button
					class="sidebar-folder__chevron-btn"
					onclick={toggleExpanded}
					aria-expanded={folder.isExpanded}
					aria-label={folder.name}
					data-testid="folder-toggle"
				>
					<ChevronRight
						class="sidebar-folder__chevron base-icon {folder.isExpanded
							? 'sidebar-folder__chevron--expanded'
							: ''}"
					/>
				</button>
				<button
					class="sidebar-folder__name-btn"
					onclick={toggleExpanded}
					aria-expanded={folder.isExpanded}
					data-testid="folder-name-toggle"
				>
					<span class="sidebar-folder__title">{folder.name}</span>
					<Metadata>{$LL.folderSessionCount({ count: sessions.length })}</Metadata>
				</button>
			</div>
		{/if}

		<nav
			class="sidebar-folder__actions"
			class:sidebar-folder__actions--editing={isEditing}
			class:sidebar-folder__actions--confirm-deletion={isDeleting}
		>
			{#if !isDeleting}
				<ButtonEdit
					bind:shouldConfirmEdit={isEditing}
					onConfirm={handleRename}
					onCancel={cancelEdit}
				/>
			{/if}
			{#if !isEditing}
				<div class="delete-button" class:delete--confirm-deletion={isDeleting}>
					{#if isDeleting}
						<Button
							variant="icon"
							onclick={() => deleteFolder(folder.id)}
							title={$LL.confirmDeletion()}
							data-testid="folder-delete-confirm"
						>
							<Trash2 class="base-icon" />
						</Button>
						<Button variant="icon" onclick={() => (isDeleting = false)} title={$LL.dismiss()}>
							{$LL.dismiss()}
						</Button>
					{:else}
						<Button
							variant="icon"
							onclick={() => (isDeleting = true)}
							title={$LL.deleteFolder()}
							data-testid="folder-delete"
						>
							<Trash2 class="base-icon" />
						</Button>
					{/if}
				</div>
			{/if}
		</nav>
	</div>

	{#if folder.isExpanded}
		<div class="sidebar-folder__sessions">
			{#each sessions as session (session.id)}
				<SidebarSessionItem
					id={session.id}
					title={getSessionTitle(session)}
					subtitle={formatSessionMetadata(session)}
					folderId={folder.id}
					{isMultiSelectMode}
					isSelected={selectedIds?.has(session.id) ?? false}
					{onToggleSelect}
				/>
			{/each}
		</div>
	{/if}
</div>

<style lang="postcss">
	.sidebar-folder {
		@apply border-b last:border-b-0;
	}

	.sidebar-folder--drag-over {
		@apply bg-shade-2 outline outline-2 -outline-offset-2 outline-accent;
	}

	.sidebar-folder__header {
		@apply flex flex-row items-center justify-between pr-3;
	}

	.sidebar-folder__toggle-row {
		@apply flex flex-1 items-center overflow-hidden;
	}

	.sidebar-folder__chevron-btn {
		@apply flex items-center py-3 pl-5 pr-1;
		@apply hover:text-active;
	}

	.sidebar-folder__name-btn {
		@apply flex flex-1 items-center gap-2 overflow-hidden py-3 pr-0 text-left;
		@apply hover:text-active;
	}

	/* Applied via `class` prop to the ChevronRight icon component, so the class
	   lands on a child component's root node — Svelte's scoped-CSS pruning
	   can't see that statically and would otherwise flag these as unused. */
	:global(.sidebar-folder__chevron) {
		@apply flex-shrink-0 transition-transform duration-100;
	}

	:global(.sidebar-folder__chevron--expanded) {
		@apply rotate-90;
	}

	.sidebar-folder__title {
		@apply max-w-full truncate whitespace-nowrap text-sm font-bold;
	}

	.sidebar-folder__content {
		@apply flex flex-1 flex-col px-6 py-3;
	}

	.sidebar-folder__title-input {
		@apply w-full bg-transparent text-sm font-bold;
		@apply focus:outline-none focus:ring-0;
	}

	.sidebar-folder:hover .sidebar-folder__actions,
	.sidebar-folder:focus-within .sidebar-folder__actions {
		@apply opacity-100;
	}

	.sidebar-folder__actions {
		/* Opacity-only (not visibility:hidden) plus :focus-within above, so the
		   folder rename/delete buttons stay in the tab order and are reachable
		   by keyboard — the same fix applied to session-item actions. */
		@apply flex flex-row items-center opacity-0;
	}

	.sidebar-folder__actions--confirm-deletion,
	.sidebar-folder__actions--editing {
		@apply opacity-100;
	}

	.sidebar-folder__sessions {
		@apply border-t bg-shade-2/50 pl-3;
	}

	.delete-button {
		@apply flex h-full flex-row;
	}
</style>
