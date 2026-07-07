<script lang="ts">
	import { Check, ChevronDown, FolderInput } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import { page } from '$app/state';
	import { createFolder, moveSessionToFolder } from '$lib/folders';
	import { foldersStore, sessionsStore } from '$lib/localStorage';
	import { saveSession } from '$lib/sessions';
	import { Sitemap } from '$lib/sitemap';

	import Badge from './Badge.svelte';
	import ButtonDelete from './ButtonDelete.svelte';
	import ButtonEdit from './ButtonEdit.svelte';
	import Metadata from './Metadata.svelte';

	// Design contract: this component must not read $sessionsStore during teardown
	// (onDestroy, $effect cleanup, or {#key} re-creation) — sessions may be removed
	// from the store (single or batch delete) while an item instance is still
	// mounted, and a store read at that point could operate on stale/missing data.
	// All rendering data (id, title, subtitle) is received via props instead.
	interface Props {
		id: string;
		title: string;
		subtitle: string;
		/** The id of the folder this item is currently rendered under, if any.
		 * Used only to decide whether "Remove from folder" appears in the move
		 * menu — not read from the store, so it stays consistent with the
		 * teardown-safety contract above. */
		folderId?: string;
		/** Folder name shown as a badge — used only in search results, where
		 * sessions from different folders are flattened into one list and
		 * need their folder context surfaced. */
		folderBadge?: string;
		isMultiSelectMode?: boolean;
		isSelected?: boolean;
		onToggleSelect?: (id: string, event: MouseEvent) => void;
	}

	let {
		id,
		title,
		subtitle,
		folderId,
		folderBadge,
		isMultiSelectMode = false,
		isSelected = false,
		onToggleSelect
	}: Props = $props();
	let isEditing = $state(false);
	let editedTitle = $state(title);
	let titleInput: HTMLInputElement | null = $state(null);
	let isDeleting = $state(false);
	let isMoveMenuOpen = $state(false);

	$effect(() => {
		if (isEditing && titleInput) titleInput.focus();
	});

	function handleTitleEdit() {
		if (editedTitle !== title) {
			const session = $sessionsStore.find((s) => s.id === id);
			if (session) {
				session.title = editedTitle;
				saveSession(session);
			}
		}
		isEditing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleTitleEdit();
	}

	function cancelEdit() {
		editedTitle = title;
		isEditing = false;
	}

	function handleDragStart(e: DragEvent) {
		e.dataTransfer?.setData('text/plain', id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function handleMoveToFolder(targetFolderId: string | undefined) {
		moveSessionToFolder(id, targetFolderId);
		isMoveMenuOpen = false;
	}

	function handleNewFolderAndMove() {
		const folder = createFolder($LL.newFolder());
		moveSessionToFolder(id, folder.id);
		isMoveMenuOpen = false;
	}

	function handleMoveMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			isMoveMenuOpen = false;
			moveMenuTrigger?.focus();
		}
	}

	let moveMenuTrigger: HTMLButtonElement | null = $state(null);

	function handleCheckboxClick(e: MouseEvent) {
		// A <button role="checkbox"> — no native toggle to prevent. stopPropagation
		// keeps the click off the row/link and the outside-click menu handlers.
		e.stopPropagation();
		onToggleSelect?.(id, e);
	}

	function handleLinkClick(e: MouseEvent) {
		if (!isMultiSelectMode) return;
		e.preventDefault();
		onToggleSelect?.(id, e);
	}
</script>

<!-- svelte:window must live at the template's top level (Svelte forbids it
	inside blocks); the handlers below just no-op when the menu is closed. -->
<svelte:window
	onclick={() => {
		if (isMoveMenuOpen) isMoveMenuOpen = false;
	}}
	onblur={() => {
		if (isMoveMenuOpen) isMoveMenuOpen = false;
	}}
/>

<!-- Need to use `#key id` to re-render the delete nav after deletion -->
{#key id}
	<div
		class="section-list-item"
		class:section-list-item--active={page.url.pathname.includes(id)}
		class:section-list-item--confirm-deletion={isDeleting}
		class:section-list-item--editing={isEditing}
		class:section-list-item--multi-select={isMultiSelectMode}
		class:section-list-item--selected={isMultiSelectMode && isSelected}
		role="group"
		aria-label={title}
		draggable="true"
		ondragstart={handleDragStart}
		data-testid="session-item-draggable"
	>
		<!-- A custom <button role="checkbox"> instead of a native <input>: a
			controlled native checkbox (`checked={isSelected}`) desyncs in Svelte 5
			once the user clicks it — the click's activation behavior mutates the
			DOM `checked` property behind Svelte's back, and Svelte then skips
			re-asserting a value it believes is unchanged, so the box stops
			reflecting the real selection (the row still highlights, because class
			bindings on isSelected keep working). Driving the visual purely from
			`isSelected` in the template — exactly like the row highlight — avoids
			that entirely. -->
		<button
			type="button"
			role="checkbox"
			aria-checked={isSelected}
			class="section-list-item__checkbox"
			class:section-list-item__checkbox--checked={isSelected}
			aria-label={`${$LL.selectSession()}: ${title}`}
			data-testid="session-select-checkbox"
			onclick={handleCheckboxClick}
		>
			{#if isSelected}
				<Check class="section-list-item__checkmark" />
			{/if}
		</button>
		{#if isEditing}
			<div class="section-list-item__content">
				<input
					bind:this={titleInput}
					bind:value={editedTitle}
					class="section-list-item__title-input"
					type="text"
					onkeydown={handleKeydown}
				/>
				<Metadata>
					{$LL.editTitle()}
				</Metadata>
			</div>
		{:else}
			<a
				class="section-list-item__a"
				data-testid="session-item"
				aria-label={$LL.session() + `: ${id}`}
				href={`/${Sitemap.SESSIONS}/${id}`}
				onclick={handleLinkClick}
			>
				<p class="section-list-item__title">
					{title}
				</p>
				<Metadata>
					{subtitle}
					{#if folderBadge}
						<Badge>{folderBadge}</Badge>
					{/if}
				</Metadata>
			</a>
		{/if}
		{#if !isMultiSelectMode}
		<nav
			class="section-list-item__actions"
			class:section-list-item__actions--confirm-deletion={isDeleting}
			class:section-list-item__actions--editing={isEditing}
		>
			{#if !isDeleting && !isEditing}
				<div class="move-menu">
					<button
						bind:this={moveMenuTrigger}
						type="button"
						class="base-button base-button--icon move-menu__trigger"
						title={$LL.moveToFolder()}
						aria-haspopup="menu"
						aria-expanded={isMoveMenuOpen}
						data-testid="session-move-trigger"
						onclick={(e) => {
							e.stopPropagation();
							isMoveMenuOpen = !isMoveMenuOpen;
						}}
					>
						<FolderInput class="base-icon" />
						<ChevronDown class="base-icon move-menu__chevron" />
					</button>
					{#if isMoveMenuOpen}
						<div
							class="move-menu__content"
							role="menu"
							tabindex="-1"
							aria-label={$LL.moveToFolder()}
							onkeydown={handleMoveMenuKeydown}
						>
							{#if folderId}
								<button
									type="button"
									role="menuitem"
									class="move-menu__item"
									onclick={(e) => {
										e.stopPropagation();
										handleMoveToFolder(undefined);
									}}
								>
									{$LL.removeFromFolder()}
								</button>
							{/if}
							{#each $foldersStore as folder (folder.id)}
								{#if folder.id !== folderId}
									<button
										type="button"
										role="menuitem"
										class="move-menu__item"
										onclick={(e) => {
											e.stopPropagation();
											handleMoveToFolder(folder.id);
										}}
									>
										{folder.name}
									</button>
								{/if}
							{/each}
							<button
								type="button"
								role="menuitem"
								class="move-menu__item"
								onclick={(e) => {
									e.stopPropagation();
									handleNewFolderAndMove();
								}}
							>
								{$LL.newFolderEllipsis()}
							</button>
						</div>
					{/if}
				</div>
			{/if}
			{#if !isDeleting}
				<ButtonEdit
					bind:shouldConfirmEdit={isEditing}
					onConfirm={handleTitleEdit}
					onCancel={cancelEdit}
				/>
			{/if}
			{#if !isEditing}
				<ButtonDelete sitemap={Sitemap.SESSIONS} {id} bind:shouldConfirmDeletion={isDeleting} />
			{/if}
		</nav>
		{/if}
	</div>
{/key}

<style lang="postcss">
	.section-list-item {
		@apply flex flex-row items-center justify-between border-b pr-3;
		@apply last:border-b-0;

		&--confirm-deletion {
			@apply confirm-deletion;
		}

		&--editing {
			@apply confirm-editing;
		}
	}

	.section-list-item__content {
		@apply flex flex-1 flex-col px-6 py-3;
	}

	.section-list-item__checkbox {
		@apply ml-4 flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border border-shade-6 bg-shade-0 opacity-0;
	}

	.section-list-item__checkbox--checked {
		@apply border-blue-500 bg-blue-500;
	}

	/* The Check icon renders inside a child component, so its class lands on a
	   node scoped-CSS can't see statically — mark it :global. */
	:global(.section-list-item__checkmark) {
		@apply h-3 w-3 text-white;
	}

	.section-list-item:hover .section-list-item__checkbox,
	.section-list-item:focus-within .section-list-item__checkbox,
	.section-list-item--multi-select .section-list-item__checkbox {
		@apply opacity-100;
	}

	.section-list-item:hover .section-list-item__actions,
	.section-list-item:focus-within .section-list-item__actions {
		@apply opacity-100;
	}

	.section-list-item__actions {
		/* Opacity-only, NOT `invisible` (visibility:hidden). visibility:hidden
		   removes the move-to-folder / edit / delete buttons from the tab order
		   in every major browser, so :focus-within could never fire and a
		   keyboard-only user could never reach the DnD-alternative "Move to
		   folder" menu. Keeping them visible-but-transparent leaves them
		   focusable, so Tab reveals them via :focus-within above. */
		@apply flex flex-row items-center opacity-0;
	}

	.section-list-item__actions--confirm-deletion,
	.section-list-item__actions--editing {
		@apply opacity-100;
	}

	.move-menu {
		@apply relative flex h-full items-center;
	}

	.move-menu__trigger {
		@apply flex items-center;
	}

	:global(.move-menu__chevron) {
		@apply -ml-1 h-3 w-3;
	}

	.move-menu__content {
		@apply overflow-scrollbar absolute right-0 top-full z-10 flex max-h-64 min-w-40 flex-col;
		@apply rounded-md border bg-shade-0 py-1 shadow-md;
	}

	.move-menu__item {
		@apply w-full truncate px-3 py-1.5 text-left text-sm hover:bg-shade-1;
	}

	.section-list-item--active {
		@apply bg-shade-0;
	}

	.section-list-item--selected {
		/* A blue tint plus a solid blue left bar — clearly visible in BOTH light
		   and dark (the old bg-shade-2 was nearly invisible, especially in
		   light), and it matches the checkbox's blue check. The inset box-shadow
		   draws the bar without shifting layout. */
		@apply bg-blue-500/20;
		box-shadow: inset 3px 0 0 0 #3b82f6;
	}

	.section-list-item__a {
		@apply relative z-0 w-full overflow-hidden text-ellipsis py-3 pl-5 pr-0;
		@apply hover:text-active;
	}

	.section-list-item__title {
		@apply max-w-full truncate whitespace-nowrap text-sm font-bold;
	}

	.section-list-item__title-input {
		@apply w-full bg-transparent text-sm font-bold;
		@apply focus:outline-none focus:ring-0;
	}
</style>
