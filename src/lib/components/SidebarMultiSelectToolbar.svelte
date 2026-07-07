<script lang="ts">
	import { Trash2, X } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';

	import Button from './Button.svelte';

	interface Props {
		selectedCount: number;
		totalVisibleCount: number;
		onSelectAll: () => void;
		onDeselectAll: () => void;
		onCancel: () => void;
		onDelete: () => void;
	}

	let { selectedCount, totalVisibleCount, onSelectAll, onDeselectAll, onCancel, onDelete }: Props =
		$props();

	const allSelected = $derived(totalVisibleCount > 0 && selectedCount >= totalVisibleCount);
</script>

<div class="multi-select-toolbar" data-testid="multi-select-toolbar">
	<div class="multi-select-toolbar__row">
		<button
			type="button"
			class="base-button base-button--icon"
			title={$LL.cancelSelection()}
			aria-label={$LL.cancelSelection()}
			onclick={onCancel}
			data-testid="multi-select-cancel"
		>
			<X class="base-icon" />
		</button>
		<span class="multi-select-toolbar__count" data-testid="multi-select-count">
			{$LL.nSelected({ count: selectedCount })}
		</span>
		<button
			type="button"
			class="multi-select-toolbar__select-all"
			onclick={allSelected ? onDeselectAll : onSelectAll}
			data-testid="multi-select-select-all"
		>
			{allSelected ? $LL.deselectAll() : $LL.selectAll()}
		</button>
	</div>
	<Button
		variant="outline"
		class="w-full"
		onclick={onDelete}
		disabled={selectedCount === 0}
		data-testid="multi-select-delete"
	>
		<Trash2 class="base-icon" />
		{$LL.deleteNConversations({ count: selectedCount })}
	</Button>
</div>

<style lang="postcss">
	.multi-select-toolbar {
		@apply flex flex-col gap-2 border-b bg-shade-2 px-3 py-2;
	}

	.multi-select-toolbar__row {
		@apply flex items-center justify-between gap-2;
	}

	.multi-select-toolbar__count {
		@apply flex-1 text-sm font-medium;
	}

	.multi-select-toolbar__select-all {
		@apply text-sm text-link hover:underline;
	}
</style>
