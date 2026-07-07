<script lang="ts">
	import { BookOpen, Moon, NotebookPen, Settings2, Sun } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import { settingsStore } from '$lib/localStorage';

	interface Props {
		pathname: string;
	}

	let { pathname }: Props = $props();

	function toggleTheme() {
		$settingsStore.userTheme = $settingsStore.userTheme === 'light' ? 'dark' : 'light';
	}
</script>

<div class="border-t px-2 py-3">
	<a
		href="/motd"
		class="duration-25 flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:text-active {pathname.includes(
			'/motd'
		)
			? 'text-active'
			: 'text-muted'}"
		aria-current={pathname.includes('/motd') ? 'page' : undefined}
	>
		<BookOpen class="h-4 w-4" />
		{$LL.motd()}
	</a>

	<a
		href="/settings"
		class="duration-25 flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:text-active {pathname.includes(
			'/settings'
		)
			? 'text-active'
			: 'text-muted'}"
		aria-current={pathname.includes('/settings') ? 'page' : undefined}
	>
		<Settings2 class="h-4 w-4" />
		{$LL.settings()}
	</a>

	<a
		href="/system-prompt"
		class="duration-25 flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors hover:text-active {pathname ===
		'/system-prompt'
			? 'text-active'
			: 'text-muted'}"
		aria-current={pathname === '/system-prompt' ? 'page' : undefined}
	>
		<NotebookPen class="h-4 w-4" />
		{$LL.globalSystemPromptShort()}
		{#if $settingsStore.globalSystemPrompt?.trim()}
			<span class="bg-primary h-2 w-2 flex-shrink-0 rounded-full"></span>
		{/if}
	</a>

	<button
		onclick={toggleTheme}
		class="duration-25 flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-active"
	>
		{#if $settingsStore.userTheme === 'light'}
			<Moon class="h-4 w-4" />
			{$LL.dark()}
		{:else}
			<Sun class="h-4 w-4" />
			{$LL.light()}
		{/if}
	</button>
</div>
