<script lang="ts">
	import Plus from 'lucide-svelte/icons/plus';
	import Trash_2 from 'lucide-svelte/icons/trash-2';

	import LL from '$i18n/i18n-svelte';
	import Button from '$lib/components/Button.svelte';
	import FieldHelp from '$lib/components/FieldHelp.svelte';
	import P from '$lib/components/P.svelte';
	import { sanitizeHeaders } from '$lib/connections';

	const MAX_ENTRIES = 20;

	interface Props {
		headers: Record<string, string>;
		onchange: (headers: Record<string, string>) => void;
	}

	let { headers, onchange }: Props = $props();

	let entries: { key: string; value: string }[] = $state([]);
	let isExpanded = $state(false);

	// Non-reactive snapshot of the last `headers` value this component either
	// synced IN from the parent or emitted OUT itself. The effect below re-syncs
	// `entries` ONLY when `headers` differs from this snapshot — i.e. on a
	// genuine EXTERNAL change (the parent resetting to {} after a verify, or
	// loading a different server's stored headers). It must NOT be $state: the
	// effect has to read `headers` (that's the whole point), and the previous
	// version also read `entries` to dirty-check, which made `entries` its own
	// dependency — so addEntry() re-ran the effect, which saw `headers` still
	// empty (empty/partial rows aren't emitted) and wiped the row just added.
	// Comparing against a plain snapshot instead breaks that feedback loop and
	// lets local edits (added rows, half-typed keys) survive.
	let lastSyncedHeaders: Record<string, string> = {};

	function headersEqual(a: Record<string, string>, b: Record<string, string>): boolean {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		return aKeys.length === bKeys.length && aKeys.every((k) => a[k] === b[k]);
	}

	$effect(() => {
		if (headersEqual(headers, lastSyncedHeaders)) return;
		// Snapshot a CLONE, not the live `headers` reference: aliasing it would let
		// a later in-place mutation of the parent's object silently match the
		// snapshot and defeat the external-change detection this guard exists for.
		lastSyncedHeaders = { ...headers };
		entries = Object.entries(headers)
			.slice(0, MAX_ENTRIES)
			.map(([key, value]) => ({ key, value }));
		isExpanded = entries.length > 0;
	});

	function emitChange() {
		const seen = new Map<string, string>();
		for (const entry of entries) {
			const key = entry.key.trim();
			if (key && entry.value) seen.set(key.toLowerCase(), entry.value);
		}
		const next = sanitizeHeaders(Object.fromEntries(seen));
		// Record what we're emitting BEFORE notifying the parent, so when the
		// parent echoes this same value back down as `headers` the effect sees it
		// as already-in-sync and leaves the live rows (and their original casing /
		// in-progress empty rows) untouched.
		lastSyncedHeaders = next;
		onchange(next);
	}

	function addEntry() {
		if (entries.length >= MAX_ENTRIES) return;
		if (!isExpanded) isExpanded = true;
		entries = [...entries, { key: '', value: '' }];
	}

	function removeEntry(index: number) {
		entries = entries.filter((_, i) => i !== index);
		if (entries.length === 0) isExpanded = false;
		emitChange();
	}
</script>

<div class="extra-headers">
	{#if isExpanded && entries.length > 0}
		<span class="extra-headers__label">{$LL.customHeaders()}</span>
		<div class="extra-headers__list">
			{#each entries as entry, index (index)}
				<div class="extra-headers__row">
					<input
						class="extra-headers__input"
						aria-label={$LL.headerName()}
						placeholder={$LL.headerName()}
						value={entry.key}
						oninput={(e) => {
							entries[index].key = e.currentTarget.value;
							emitChange();
						}}
					/>
					<input
						class="extra-headers__input"
						aria-label={$LL.headerValue()}
						placeholder={$LL.headerValue()}
						value={entry.value}
						oninput={(e) => {
							entries[index].value = e.currentTarget.value;
							emitChange();
						}}
					/>
					<Button
						variant="icon"
						on:click={() => removeEntry(index)}
						aria-label={$LL.removeHeader()}
					>
						<Trash_2 class="base-icon" />
					</Button>
				</div>
			{/each}
		</div>
	{/if}

	{#if entries.length < MAX_ENTRIES}
		<Button variant="outline" on:click={addEntry}>
			<Plus class="base-icon" />
			{$LL.addHeader()}
		</Button>
	{/if}

	{#if isExpanded && entries.length > 0}
		<FieldHelp>
			<P>{$LL.customHeadersHelp()}</P>
			<P>{$LL.customHeadersCorsWarning()}</P>
		</FieldHelp>
	{/if}
</div>

<style lang="postcss">
	.extra-headers {
		@apply flex flex-col gap-y-2;
	}

	.extra-headers__label {
		@apply text-xs font-medium leading-none text-muted;
	}

	.extra-headers__list {
		@apply flex flex-col gap-y-2;
	}

	.extra-headers__row {
		@apply grid grid-cols-[1fr_1fr_auto] items-center gap-x-2;
	}

	.extra-headers__input {
		@apply base-input;
	}
</style>
