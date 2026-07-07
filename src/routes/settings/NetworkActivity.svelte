<script lang="ts">
	import Fieldset from '$lib/components/Fieldset.svelte';
	import P from '$lib/components/P.svelte';
	import { networkLog } from '$lib/networkLog';

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString();
	}
</script>

<Fieldset>
	<P><strong>Network Activity</strong></P>

	{#if $networkLog.length === 0}
		<P>No network requests recorded yet.</P>
	{:else}
		<div class="network-log">
			{#each $networkLog as entry (entry.timestamp)}
				<div class="network-log__entry">
					<span class="network-log__time">{formatTime(entry.timestamp)}</span>
					<span class="network-log__method">{entry.method}</span>
					<span class="network-log__status" class:error={entry.status >= 400}
						>{entry.status}</span
					>
					<span class="network-log__url" title={entry.url}>{entry.url}</span>
					<span class="network-log__source">{entry.source}</span>
				</div>
			{/each}
		</div>
	{/if}
</Fieldset>

<style lang="postcss">
	.network-log {
		@apply flex max-h-64 flex-col overflow-auto rounded-md border border-shade-3;
	}

	.network-log__entry {
		@apply flex items-center gap-2 border-b border-shade-3 px-3 py-1.5 text-xs last:border-b-0;
	}

	.network-log__time {
		@apply shrink-0 text-muted;
	}

	.network-log__method {
		@apply shrink-0 font-mono font-semibold;
	}

	.network-log__status {
		@apply shrink-0 font-mono;
	}

	.network-log__status.error {
		@apply text-red-500;
	}

	.network-log__url {
		@apply min-w-0 flex-1 truncate font-mono text-muted;
	}

	.network-log__source {
		@apply shrink-0 rounded bg-shade-2 px-1.5 py-0.5 text-muted;
	}
</style>
