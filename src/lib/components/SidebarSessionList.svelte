<script lang="ts">
	import { FolderPlus } from 'lucide-svelte';
	import { tick } from 'svelte';

	import LL from '$i18n/i18n-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createFolder, getFoldersWithSessions, moveSessionToFolder } from '$lib/folders';
	import { foldersStore, sessionsStore } from '$lib/localStorage';
	import { formatSessionMetadata, getSessionTitle, type Session } from '$lib/sessions';

	import Button from './Button.svelte';
	import EmptyMessage from './EmptyMessage.svelte';
	import SectionList from './SectionList.svelte';
	import SidebarFolder from './SidebarFolder.svelte';
	import SidebarMultiSelectToolbar from './SidebarMultiSelectToolbar.svelte';
	import SidebarSearch from './SidebarSearch.svelte';
	import SidebarSessionItem from './SidebarSessionItem.svelte';
	import StorageBanner from './StorageBanner.svelte';

	interface Props {
		/** Owned by the parent (CollapsibleSidebar), not here — this component
		 * fully unmounts when switching to the Knowledge tab (the parent renders
		 * the two tabs conditionally), so state kept locally would reset on every
		 * tab switch. Lifting it to the always-mounted parent lets the query
		 * survive across tab switches as required. */
		query: string;
	}

	let { query = $bindable('') }: Props = $props();

	const q = $derived(query.trim().toLowerCase());

	// getFoldersWithSessions() reads the stores via get() (a one-time snapshot,
	// not a subscription), so this $derived must dereference both stores
	// directly ($sessionsStore / $foldersStore) to stay reactive to session
	// and folder changes (create, rename, delete, expand/collapse, moves).
	const grouped = $derived.by(() => {
		void $sessionsStore;
		void $foldersStore;
		return getFoldersWithSessions();
	});

	function sessionMatchesQuery(session: Session): boolean {
		const title = getSessionTitle(session).toLowerCase();
		const model = session.model?.name?.toLowerCase() ?? '';
		return title.includes(q) || model.includes(q) || session.id.toLowerCase().includes(q);
	}

	// Search flattens the folder hierarchy — matches can come from any folder
	// or from unfiled, shown together with a badge naming their folder.
	const searchResults = $derived.by(() => {
		if (!q) return [];
		const folderNameById = new Map($foldersStore.map((f) => [f.id, f.name]));
		return $sessionsStore.filter(sessionMatchesQuery).map((session) => ({
			session,
			folderName: session.folderId ? folderNameById.get(session.folderId) : undefined
		}));
	});

	// Drag-over target ('unfiled' or a folder id), owned here rather than per
	// drop-target component so a single window-blur listener can reset it.
	// HTML5 DnD in Chromium/Electron can fail to fire `dragend` on Alt+Tab or
	// window focus loss, which would otherwise leave a drop target's
	// highlight stuck permanently.
	let dragOverTarget: string | null = $state(null);

	function handleNewFolder() {
		createFolder($LL.newFolder());
	}

	// --- Multi-select ---
	// Component-level, not persisted — selection is temporary UI state that
	// resets on navigation/tab switch, unlike the search query above.
	let selectedIds = $state<Set<string>>(new Set());
	let lastClickedIndex: number | null = $state(null);
	let isMultiSelectMode = $state(false);

	// The index source for shift-click range selection: the visual render
	// order, not store order. Collapsed folders contribute nothing (their
	// sessions aren't visible), and search flattens to the matched list.
	const flatVisibleIds = $derived.by(() => {
		if (q) return searchResults.map((r) => r.session.id);
		return [
			...grouped.unfiled.map((s) => s.id),
			...grouped.folders.flatMap((f) => (f.folder.isExpanded ? f.sessions.map((s) => s.id) : []))
		];
	});

	function handleToggleSelect(id: string, event: MouseEvent) {
		const index = flatVisibleIds.indexOf(id);
		const newSelected = new Set(selectedIds);

		if (event.shiftKey && lastClickedIndex !== null) {
			const start = Math.min(lastClickedIndex, index);
			const end = Math.max(lastClickedIndex, index);
			for (let i = start; i <= end; i++) newSelected.add(flatVisibleIds[i]);
		} else {
			if (newSelected.has(id)) newSelected.delete(id);
			else newSelected.add(id);
			lastClickedIndex = index;
		}

		selectedIds = newSelected;
		// Exit multi-select mode when the last item is deselected — otherwise the
		// mode stays stuck on with an empty selection, and every session item's
		// link keeps preventing navigation (clicks toggle selection instead of
		// opening the conversation).
		isMultiSelectMode = newSelected.size > 0;
	}

	function handleSelectAll() {
		selectedIds = new Set(flatVisibleIds);
	}

	function handleDeselectAll() {
		selectedIds = new Set();
	}

	function exitMultiSelect() {
		isMultiSelectMode = false;
		selectedIds = new Set();
		lastClickedIndex = null;
	}

	async function handleBatchDelete() {
		if (selectedIds.size === 0) return;
		if (!confirm($LL.areYouSureYouWantToDeleteNSessions({ count: selectedIds.size }))) return;

		const currentSessionId = page.url.pathname.match(/^\/sessions\/(.+)$/)?.[1];
		const isViewingDeletedSession = currentSessionId ? selectedIds.has(currentSessionId) : false;

		sessionsStore.update((sessions) => sessions.filter((s) => !selectedIds.has(s.id)));
		await tick();

		if (isViewingDeletedSession) await goto('/sessions');

		exitMultiSelect();
	}

	function handleUnfiledDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dragOverTarget = 'unfiled';
	}

	function handleUnfiledDrop(e: DragEvent) {
		e.preventDefault();
		const sessionId = e.dataTransfer?.getData('text/plain');
		if (sessionId) moveSessionToFolder(sessionId, undefined);
		dragOverTarget = null;
	}
</script>

<svelte:window onblur={() => (dragOverTarget = null)} />

<div class="sidebar-session-list">
	<StorageBanner />

	{#if $sessionsStore && $sessionsStore.length > 0}
		<SidebarSearch bind:query />
	{/if}

	{#if isMultiSelectMode}
		<SidebarMultiSelectToolbar
			selectedCount={selectedIds.size}
			totalVisibleCount={flatVisibleIds.length}
			onSelectAll={handleSelectAll}
			onDeselectAll={handleDeselectAll}
			onCancel={exitMultiSelect}
			onDelete={handleBatchDelete}
		/>
	{/if}

	<div class="sidebar-session-list__new-folder">
		<Button variant="outline" class="w-full" onclick={handleNewFolder} data-testid="new-folder">
			<FolderPlus class="base-icon" />
			{$LL.newFolder()}
		</Button>
	</div>

	<SectionList>
		{#if (!$sessionsStore || $sessionsStore.length === 0) && $foldersStore.length === 0}
			<EmptyMessage>{$LL.emptySessions()}</EmptyMessage>
		{:else if q}
			{#if searchResults.length > 0}
				{#each searchResults as { session, folderName } (session.id)}
					<SidebarSessionItem
						id={session.id}
						title={getSessionTitle(session)}
						subtitle={formatSessionMetadata(session)}
						folderBadge={folderName}
						{isMultiSelectMode}
						isSelected={selectedIds.has(session.id)}
						onToggleSelect={handleToggleSelect}
					/>
				{/each}
			{:else}
				<EmptyMessage>{$LL.noSessionsMatchSearch()}</EmptyMessage>
			{/if}
		{:else}
			<div
				class="sidebar-session-list__unfiled"
				class:sidebar-session-list__unfiled--drag-over={dragOverTarget === 'unfiled'}
				role="group"
				aria-label={$LL.unfiled()}
				ondragover={handleUnfiledDragOver}
				ondragleave={() => {
					if (dragOverTarget === 'unfiled') dragOverTarget = null;
				}}
				ondrop={handleUnfiledDrop}
				data-testid="unfiled-drop-zone"
			>
				{#each grouped.unfiled as session (session.id)}
					<SidebarSessionItem
						id={session.id}
						title={getSessionTitle(session)}
						subtitle={formatSessionMetadata(session)}
						{isMultiSelectMode}
						isSelected={selectedIds.has(session.id)}
						onToggleSelect={handleToggleSelect}
					/>
				{/each}
			</div>
			{#each grouped.folders as { folder, sessions } (folder.id)}
				<SidebarFolder
					{folder}
					{sessions}
					isDragOver={dragOverTarget === folder.id}
					{isMultiSelectMode}
					{selectedIds}
					onToggleSelect={handleToggleSelect}
					onDragEnter={() => (dragOverTarget = folder.id)}
					onDragLeave={() => {
						if (dragOverTarget === folder.id) dragOverTarget = null;
					}}
					onDropSession={(sessionId) => {
						moveSessionToFolder(sessionId, folder.id);
						dragOverTarget = null;
					}}
				/>
			{/each}
		{/if}
	</SectionList>
</div>

<style lang="postcss">
	.sidebar-session-list {
		@apply flex h-full flex-col;
	}

	.sidebar-session-list__new-folder {
		@apply border-b px-3 py-2;
	}

	.sidebar-session-list__unfiled--drag-over {
		@apply bg-shade-2 outline outline-2 -outline-offset-2 outline-accent;
	}
</style>
