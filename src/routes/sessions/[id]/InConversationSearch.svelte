<script lang="ts">
	import { ChevronDown, ChevronUp, X } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	import LL from '$i18n/i18n-svelte';
	import Button from '$lib/components/Button.svelte';
	import { clearHighlights, highlightMatches } from '$lib/messageSearch';
	import type { Message } from '$lib/sessions';

	interface Props {
		messages: Message[];
		containerEl: HTMLElement | undefined;
		onClose: () => void;
	}

	let { messages, containerEl, onClose }: Props = $props();

	let query = $state('');
	let marks: HTMLElement[] = $state([]);
	let currentIndex = $state(0);
	let searchInput: HTMLInputElement | undefined = $state();

	// Rebuilds whenever the query changes or the finalized message list
	// changes (edits, new messages). Reading `messages` (not editor.completion)
	// is what keeps this from re-searching a mutating string on every token
	// while a response is streaming in.
	$effect(() => {
		void messages;
		const trimmed = query.trim();
		if (!containerEl) return;
		marks = trimmed ? highlightMatches(containerEl, trimmed) : (clearHighlights(containerEl), []);
		currentIndex = 0;
	});

	$effect(() => {
		marks.forEach((mark, i) => {
			mark.classList.toggle('search-highlight--active', i === currentIndex);
		});
		marks[currentIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	});

	$effect(() => {
		searchInput?.focus();
	});

	onDestroy(() => {
		if (containerEl) clearHighlights(containerEl);
	});

	function goToNext() {
		if (marks.length === 0) return;
		currentIndex = (currentIndex + 1) % marks.length;
	}

	function goToPrevious() {
		if (marks.length === 0) return;
		currentIndex = (currentIndex - 1 + marks.length) % marks.length;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) goToPrevious();
			else goToNext();
		} else if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<div class="in-conversation-search" data-testid="in-conversation-search">
	<input
		bind:this={searchInput}
		type="search"
		class="in-conversation-search__input"
		placeholder={$LL.search()}
		aria-label={$LL.searchInConversation()}
		bind:value={query}
		onkeydown={handleKeydown}
		data-testid="in-conversation-search-input"
	/>
	<span class="in-conversation-search__counter" data-testid="in-conversation-search-counter">
		{#if query.trim()}
			{marks.length > 0
				? $LL.matchCounter({ current: currentIndex + 1, total: marks.length })
				: $LL.searchEmpty()}
		{/if}
	</span>
	<Button
		variant="icon"
		onclick={goToPrevious}
		disabled={marks.length === 0}
		aria-label={$LL.previousMatch()}
		data-testid="in-conversation-search-prev"
	>
		<ChevronUp class="base-icon" />
	</Button>
	<Button
		variant="icon"
		onclick={goToNext}
		disabled={marks.length === 0}
		aria-label={$LL.nextMatch()}
		data-testid="in-conversation-search-next"
	>
		<ChevronDown class="base-icon" />
	</Button>
	<Button
		variant="icon"
		onclick={onClose}
		aria-label={$LL.dismiss()}
		data-testid="in-conversation-search-close"
	>
		<X class="base-icon" />
	</Button>
</div>

<style lang="postcss">
	.in-conversation-search {
		@apply flex items-center gap-1 border-b bg-shade-1 px-3 py-2;
	}

	.in-conversation-search__input {
		@apply base-input min-w-0 flex-1 rounded-md border bg-shade-0 px-3 py-1.5 text-sm;
		@apply focus:border-shade-6 focus:outline focus:outline-shade-2;
	}

	.in-conversation-search__counter {
		@apply flex-shrink-0 whitespace-nowrap text-xs text-muted;
	}

	:global(mark.search-highlight) {
		@apply rounded-sm bg-warning-muted text-inherit;
	}

	:global(mark.search-highlight--active) {
		@apply bg-warning text-neutral-50;
	}
</style>
