<script lang="ts">
	import { Brain, MessageSquareText } from 'lucide-svelte';
	import { fade, slide } from 'svelte/transition';

	import LL from '$i18n/i18n-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { settingsStore } from '$lib/localStorage';
	import { Sitemap } from '$lib/sitemap';

	import ButtonNew from './ButtonNew.svelte';
	import SidebarBottomNav from './SidebarBottomNav.svelte';
	import SidebarKnowledgeList from './SidebarKnowledgeList.svelte';
	import SidebarSessionList from './SidebarSessionList.svelte';

	type SidebarSection = 'sessions' | 'knowledge';

	let activeSection: SidebarSection = $state('sessions');

	// Owned here (rather than inside SidebarSessionList) because that
	// component fully unmounts when switching to the Knowledge tab — state
	// kept there would reset on every tab switch. This component never
	// unmounts, so the query survives switching tabs and back.
	let sessionSearchQuery = $state('');

	const pathname = $derived(page.url.pathname);

	$effect(() => {
		if (pathname.includes('/sessions')) {
			activeSection = 'sessions';
		} else if (pathname.includes('/knowledge')) {
			activeSection = 'knowledge';
		}
	});

	function setActiveSection(section: SidebarSection) {
		activeSection = section;
		if (section === 'sessions') {
			goto('/sessions');
		} else if (section === 'knowledge') {
			goto('/knowledge');
		}
	}
</script>

{#if $settingsStore.sidebarExpanded}
	<div
		class="absolute inset-0 z-20 bg-neutral-900/50 lg:relative lg:bg-transparent"
		in:fade={{ duration: 100 }}
		out:fade={{ duration: 100 }}
	>
		<nav
			class="
		flex h-full w-[90vw] flex-shrink-0 flex-col bg-shade-1 lg:mr-4 lg:w-96 lg:rounded-xl lg:border
	"
			in:slide={{ delay: 50, duration: 100, axis: 'x' }}
			out:slide={{ duration: 100, axis: 'x' }}
			aria-label="Main navigation"
			data-testid="sidebar"
		>
			<div class="flex items-center justify-between border-b py-4">
				<a href="/" class="mx-auto flex items-center gap-2 pr-4">
					<img class="h-8 w-8" src="/favicon.png" alt="Hollama logo" />
					<span class="text-lg font-semibold tracking-tight">Hollama</span>
				</a>
			</div>

			<div class="flex bg-shade-2 px-3 py-2 text-sm" role="tablist" aria-label="Content sections">
				<button
					onclick={() => setActiveSection('sessions')}
					class="duration-25 flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-medium transition-colors hover:text-active {activeSection ===
						'sessions' && pathname.includes('/sessions')
						? 'bg-shade-0 text-active shadow-sm'
						: activeSection === 'sessions' && !pathname.includes('/sessions')
							? 'bg-shade-1 text-muted shadow-sm'
							: 'text-muted'}"
					role="tab"
					aria-selected={activeSection === 'sessions'}
					aria-controls="sessions-panel"
				>
					<MessageSquareText class="h-4 w-4" />
					{$LL.sessions()}
				</button>
				<button
					onclick={() => setActiveSection('knowledge')}
					class="duration-25 flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-medium transition-colors hover:text-active {activeSection ===
					'knowledge'
						? 'bg-shade-0 text-active shadow-sm'
						: 'text-muted'}"
					role="tab"
					aria-selected={activeSection === 'knowledge'}
					aria-controls="knowledge-panel"
				>
					<Brain class="h-4 w-4" />
					{$LL.knowledge()}
				</button>
			</div>
			<div class="border-b bg-shade-2 px-3 pb-3 pt-0">
				<ButtonNew sitemap={activeSection === 'sessions' ? Sitemap.SESSIONS : Sitemap.KNOWLEDGE} />
			</div>

			<div class="flex flex-1 flex-col overflow-hidden">
				<div class="flex-1 overflow-auto">
					<section
						class="h-full"
						id="sessions-panel"
						aria-labelledby="sessions-tab"
						hidden={activeSection !== 'sessions'}
					>
						{#if activeSection === 'sessions'}
							<SidebarSessionList bind:query={sessionSearchQuery} />
						{/if}
					</section>
					<section
						id="knowledge-panel"
						class="h-full"
						aria-labelledby="knowledge-tab"
						hidden={activeSection !== 'knowledge'}
					>
						{#if activeSection === 'knowledge'}
							<SidebarKnowledgeList />
						{/if}
					</section>
				</div>
			</div>

			<SidebarBottomNav {pathname} />
		</nav>
	</div>
{/if}
