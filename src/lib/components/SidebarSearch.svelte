<script lang="ts">
	import { Search, X } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';

	interface Props {
		query: string;
	}

	let { query = $bindable('') }: Props = $props();
</script>

<div class="sidebar-search">
	<Search class="base-icon sidebar-search__icon" />
	<input
		type="search"
		class="sidebar-search__input"
		placeholder={$LL.search()}
		aria-label={$LL.searchSessions()}
		bind:value={query}
		data-testid="sidebar-search-input"
	/>
	{#if query}
		<button
			type="button"
			class="sidebar-search__clear"
			aria-label={$LL.clearSearch()}
			onclick={() => (query = '')}
			data-testid="sidebar-search-clear"
		>
			<X class="base-icon" />
		</button>
	{/if}
</div>

<style lang="postcss">
	.sidebar-search {
		@apply relative flex items-center border-b px-3 py-2;
	}

	:global(.sidebar-search__icon) {
		@apply pointer-events-none absolute left-6 h-3.5 w-3.5 text-muted;
	}

	.sidebar-search__input {
		@apply base-input rounded-md border bg-shade-0 py-1.5 pl-8 pr-7 text-sm;
		@apply focus:border-shade-6 focus:outline focus:outline-shade-2;

		/* Suppress the native browser clear (x) button on type="search" —
		   we render our own so it matches the app's icon/button styling. */
		&::-webkit-search-cancel-button {
			@apply appearance-none;
		}
	}

	.sidebar-search__clear {
		@apply absolute right-4 text-muted hover:text-active;
	}
</style>
