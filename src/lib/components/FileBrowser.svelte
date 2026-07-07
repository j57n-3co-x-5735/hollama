<script lang="ts">
	import { ChevronRight, File, Folder, Pin, Plus, X } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';

	import Button from './Button.svelte';
	import EmptyMessage from './EmptyMessage.svelte';

	interface Entry {
		name: string;
		type: 'file' | 'dir';
		size?: number;
		modified?: string;
		/** Set only on root entries in the roots-list view. */
		rootIndex?: number;
	}

	interface Props {
		onClose: () => void;
		onSelectFile: (rootIndex: number, rel: string, name: string, persistent: boolean) => void;
	}

	let { onClose, onSelectFile }: Props = $props();

	let roots: { name: string; index: number }[] = $state([]);
	// undefined = showing the roots list; otherwise the index of the root being browsed.
	let currentRootIndex: number | undefined = $state(undefined);
	let currentRel = $state(''); // path relative to the current root ('' = root itself)
	let entries: Entry[] = $state([]);
	let isLoading = $state(true);
	let error: string | undefined = $state(undefined);

	function formatFileSize(bytes: number | undefined): string {
		if (bytes === undefined) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function loadRoots() {
		isLoading = true;
		error = undefined;
		try {
			const response = await fetch('/api/files');
			const data = await response.json();
			if (!response.ok) {
				error = data.error ?? $LL.failedToLoadDirectory();
				return;
			}
			roots = data.roots ?? [];
			// Skip straight into the only configured root — an extra click to pick
			// "the one option" would just be friction.
			if (roots.length === 1) {
				await browse(roots[0].index, '');
				return;
			}
			currentRootIndex = undefined;
			currentRel = '';
			entries = roots.map((root) => ({
				name: root.name,
				type: 'dir' as const,
				rootIndex: root.index
			}));
		} catch {
			error = $LL.failedToLoadDirectory();
		} finally {
			isLoading = false;
		}
	}

	async function browse(rootIndex: number, rel: string) {
		isLoading = true;
		error = undefined;
		try {
			const params = new URLSearchParams({ root: String(rootIndex) });
			if (rel) params.set('rel', rel);
			const response = await fetch(`/api/files?${params}`);
			const data = await response.json();
			if (!response.ok) {
				error = data.error ?? $LL.failedToLoadDirectory();
				return;
			}
			currentRootIndex = rootIndex;
			currentRel = rel;
			entries = data.entries ?? [];
		} catch {
			error = $LL.failedToLoadDirectory();
		} finally {
			isLoading = false;
		}
	}

	function handleEntryClick(entry: Entry) {
		if (entry.type !== 'dir') return;
		if (entry.rootIndex !== undefined) {
			// A root entry from the roots list.
			browse(entry.rootIndex, '');
			return;
		}
		if (currentRootIndex === undefined) return;
		browse(currentRootIndex, currentRel ? `${currentRel}/${entry.name}` : entry.name);
	}

	function selectFile(entry: Entry, persistent: boolean) {
		if (currentRootIndex === undefined) return;
		const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
		onSelectFile(currentRootIndex, rel, entry.name, persistent);
	}

	// Breadcrumb: the root name, then each relative-path segment. Each is
	// navigable back to (root, partial-rel). Absolute paths never appear.
	function breadcrumbSegments(): { label: string; rel: string }[] {
		const rootName = roots.find((r) => r.index === currentRootIndex)?.name ?? '';
		const segments = [{ label: rootName, rel: '' }];
		const parts = currentRel.split('/').filter(Boolean);
		let acc = '';
		for (const part of parts) {
			acc = acc ? `${acc}/${part}` : part;
			segments.push({ label: part, rel: acc });
		}
		return segments;
	}

	loadRoots();
</script>

<div
	class="file-browser-backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="file-browser" role="dialog" aria-label={$LL.browseFiles()} data-testid="file-browser">
		<div class="file-browser__header">
			<h2 class="file-browser__title">{$LL.browseFiles()}</h2>
			<Button variant="icon" onclick={onClose} aria-label={$LL.dismiss()}>
				<X class="base-icon" />
			</Button>
		</div>

		{#if currentRootIndex !== undefined}
			<nav class="file-browser__breadcrumbs" aria-label="Breadcrumb">
				{#each breadcrumbSegments() as segment, i (segment.rel)}
					{#if i > 0}<ChevronRight class="file-browser__breadcrumb-sep" />{/if}
					<button
						type="button"
						class="file-browser__breadcrumb"
						onclick={() => browse(currentRootIndex ?? 0, segment.rel)}
					>
						{segment.label}
					</button>
				{/each}
			</nav>
		{/if}

		<div class="file-browser__content">
			{#if isLoading}
				<EmptyMessage>…</EmptyMessage>
			{:else if error}
				<EmptyMessage>{error}</EmptyMessage>
			{:else if entries.length === 0}
				<EmptyMessage>{$LL.noFilesConfigured()}</EmptyMessage>
			{:else}
				{#each entries as entry (entry.name)}
					<div class="file-browser__entry" data-testid="file-browser-entry">
						{#if entry.type === 'dir'}
							<button
								type="button"
								class="file-browser__entry-main"
								onclick={() => handleEntryClick(entry)}
								aria-label={`${$LL.openFolder()}: ${entry.name}`}
								data-testid="file-browser-dir"
							>
								<Folder class="base-icon" />
								<span class="file-browser__entry-name">{entry.name}</span>
							</button>
						{:else}
							<div class="file-browser__entry-main">
								<File class="base-icon" />
								<span class="file-browser__entry-name">{entry.name}</span>
								<span class="file-browser__entry-meta">{formatFileSize(entry.size)}</span>
							</div>
							<div class="file-browser__entry-actions">
								<Button
									variant="icon"
									title={$LL.attachOnce()}
									aria-label={`${$LL.attachOnce()}: ${entry.name}`}
									data-testid="file-browser-attach-once"
									onclick={() => selectFile(entry, false)}
								>
									<Plus class="base-icon" />
								</Button>
								<Button
									variant="icon"
									title={$LL.attachPersistently()}
									aria-label={`${$LL.attachPersistently()}: ${entry.name}`}
									data-testid="file-browser-attach-persistent"
									onclick={() => selectFile(entry, true)}
								>
									<Pin class="base-icon" />
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style lang="postcss">
	.file-browser-backdrop {
		@apply fixed inset-0 z-30 flex items-center justify-center bg-neutral-900/50 p-4;
	}

	.file-browser {
		@apply flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border bg-shade-1;
	}

	.file-browser__header {
		@apply flex items-center justify-between border-b px-4 py-3;
	}

	.file-browser__title {
		@apply text-sm font-bold;
	}

	.file-browser__breadcrumbs {
		@apply flex flex-wrap items-center gap-1 border-b px-4 py-2 text-xs text-muted;
	}

	.file-browser__breadcrumb {
		@apply hover:text-active hover:underline;
	}

	:global(.file-browser__breadcrumb-sep) {
		@apply h-3 w-3;
	}

	.file-browser__content {
		@apply overflow-scrollbar flex-1 overflow-y-auto;
	}

	.file-browser__entry {
		@apply flex items-center justify-between gap-2 border-b px-4 py-2 last:border-b-0 hover:bg-shade-2;
	}

	.file-browser__entry-main {
		@apply flex min-w-0 flex-1 items-center gap-2 text-left text-sm;
	}

	.file-browser__entry-name {
		@apply min-w-0 flex-1 truncate;
	}

	.file-browser__entry-meta {
		@apply flex-shrink-0 text-xs text-muted;
	}

	.file-browser__entry-actions {
		@apply flex flex-shrink-0 items-center gap-1;
	}
</style>
