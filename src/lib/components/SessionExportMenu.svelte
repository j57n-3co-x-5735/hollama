<script lang="ts">
	import { ChevronDown, Files } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import { copyToClipboard, downloadTextFile } from '$lib/clipboard';
	import { formatSessionAsMarkdown, type Session } from '$lib/sessions';

	interface Props {
		session: Session;
	}

	let { session }: Props = $props();

	let isOpen = $state(false);
	let trigger: HTMLButtonElement | null = $state(null);
	let menu: HTMLDivElement | null = $state(null);

	// Move focus into the menu on open (ARIA menu pattern) so keyboard users can
	// navigate it and Escape is caught by the menu's keydown handler.
	$effect(() => {
		if (isOpen && menu) {
			(menu.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
		}
	});

	function markdownFilename(): string {
		const base = session.title || session.id;
		const slug =
			base
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40) || session.id;
		return `hollama-${slug}.md`;
	}

	function copyMarkdown() {
		copyToClipboard(formatSessionAsMarkdown(session));
		close();
	}

	function copyJson() {
		copyToClipboard(JSON.stringify(session.messages, null, 2));
		close();
	}

	function downloadMarkdown() {
		downloadTextFile(markdownFilename(), formatSessionAsMarkdown(session), 'text/markdown');
		close();
	}

	function close() {
		isOpen = false;
	}

	function handleMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			isOpen = false;
			trigger?.focus();
		}
	}
</script>

<!-- svelte:window closes the menu on outside click / focus loss (same pattern as
	the sidebar move-menu). Handlers no-op while the menu is closed. -->
<svelte:window
	onclick={() => {
		if (isOpen) isOpen = false;
	}}
	onblur={() => {
		if (isOpen) isOpen = false;
	}}
/>

<div class="export-menu">
	<button
		bind:this={trigger}
		type="button"
		class="base-button base-button--icon export-menu__trigger"
		title={$LL.copyOrExport()}
		aria-label={$LL.copyOrExport()}
		aria-haspopup="menu"
		aria-expanded={isOpen}
		data-testid="session-copy-button"
		onclick={(e) => {
			e.stopPropagation();
			isOpen = !isOpen;
		}}
	>
		<Files class="base-icon" />
		<ChevronDown class="base-icon export-menu__chevron" />
	</button>

	{#if isOpen}
		<div
			bind:this={menu}
			class="export-menu__content"
			role="menu"
			tabindex="-1"
			aria-label={$LL.copyOrExport()}
			onkeydown={handleMenuKeydown}
		>
			<button
				type="button"
				role="menuitem"
				class="export-menu__item"
				data-testid="copy-as-markdown"
				onclick={(e) => {
					e.stopPropagation();
					copyMarkdown();
				}}
			>
				{$LL.copyAsMarkdown()}
			</button>
			<button
				type="button"
				role="menuitem"
				class="export-menu__item"
				data-testid="copy-as-json"
				onclick={(e) => {
					e.stopPropagation();
					copyJson();
				}}
			>
				{$LL.copyAsJson()}
			</button>
			<button
				type="button"
				role="menuitem"
				class="export-menu__item"
				data-testid="download-markdown"
				onclick={(e) => {
					e.stopPropagation();
					downloadMarkdown();
				}}
			>
				{$LL.downloadMarkdown()}
			</button>
		</div>
	{/if}
</div>

<style lang="postcss">
	.export-menu {
		@apply relative flex items-center;
	}

	.export-menu__trigger {
		@apply flex items-center;
	}

	:global(.export-menu__chevron) {
		@apply -ml-1 h-3 w-3;
	}

	.export-menu__content {
		@apply overflow-scrollbar absolute right-0 top-full z-10 mt-1 flex min-w-44 flex-col;
		@apply rounded-md border bg-shade-0 py-1 shadow-md;
	}

	.export-menu__item {
		@apply w-full truncate px-3 py-1.5 text-left text-sm hover:bg-shade-1;
	}
</style>
