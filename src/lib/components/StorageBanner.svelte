<script lang="ts">
	import { TriangleAlert } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import { foldersStore, knowledgeStore, sessionsStore } from '$lib/localStorage';
	import {
		formatBytes,
		getStorageUsageBytes,
		STORAGE_BANNER_RATIO,
		STORAGE_LIMIT_BYTES
	} from '$lib/storage';

	// getStorageUsageBytes() reads stores via get() (a snapshot, not a
	// subscription) — dereferencing the stores here is what makes this
	// reactive to session/knowledge/folder changes.
	const usedBytes = $derived.by(() => {
		void $sessionsStore;
		void $knowledgeStore;
		void $foldersStore;
		return getStorageUsageBytes();
	});

	const isNearFull = $derived(usedBytes / STORAGE_LIMIT_BYTES >= STORAGE_BANNER_RATIO);
</script>

{#if isNearFull}
	<div class="storage-banner" data-testid="storage-banner" role="alert">
		<TriangleAlert class="base-icon" />
		<span
			>{$LL.storageNearlyFull({
				used: formatBytes(usedBytes),
				total: formatBytes(STORAGE_LIMIT_BYTES)
			})}</span
		>
	</div>
{/if}

<style lang="postcss">
	.storage-banner {
		@apply flex items-center gap-2 border-b bg-warning-muted px-3 py-2 text-xs text-warning;
	}
</style>
