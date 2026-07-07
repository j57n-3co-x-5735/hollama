<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { toast, Toaster } from 'svelte-sonner';
	import { detectLocale, navigatorDetector } from 'typesafe-i18n/detectors';

	import LL, { setLocale } from '$i18n/i18n-svelte';
	import { loadLocale } from '$i18n/i18n-util.sync';

	import '../app.pcss';

	import type { Locales } from '$i18n/i18n-types';
	import { browser } from '$app/environment';
	import { onNavigate } from '$app/navigation';
	import CollapsibleSidebar from '$lib/components/CollapsibleSidebar.svelte';
	import SidebarToggle from '$lib/components/SidebarToggle.svelte';
	import { ConnectionType, getDefaultServer, type Server } from '$lib/connections';
	import { serversStore, settingsStore, StorageKey } from '$lib/localStorage';

	let { children }: { children: Snippet } = $props();

	onNavigate((navigation) => {
		// Auto-collapse the sidebar on mobile when navigating to a full page. On
		// mobile the expanded sidebar is a 90vw drawer over a full-screen scrim
		// (see CollapsibleSidebar), so leaving it open would bury the page the
		// user just navigated to. Keep it open ONLY for the two segmented-tab list
		// views (/sessions, /knowledge), which merely swap the drawer's OWN
		// content — every other destination, including the bottom-nav links
		// (motd, settings, system-prompt), is a full page and must collapse it,
		// exactly like opening a specific session/knowledge item does.
		if (browser && window.innerWidth < 1024) {
			const raw = navigation.to?.url.pathname;
			// Normalize a trailing slash so '/sessions/' matches '/sessions' (keep
			// the bare root '/' as-is). Without this, '/sessions/' collapsed the
			// drawer while '/sessions' kept it open — an inconsistency.
			const pathname = raw && raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
			const keepOpen = ['/sessions', '/knowledge'];
			if (pathname && !keepOpen.includes(pathname)) {
				$settingsStore.sidebarExpanded = false;
			}
		}
	});

	$effect(() => {
		if (!$settingsStore.userLanguage) return;
		loadLocale($settingsStore.userLanguage);
		setLocale($settingsStore.userLanguage);
	});

	$effect(() =>
		document.documentElement.setAttribute('data-color-theme', $settingsStore.userTheme)
	);

	onMount(() => {
		// Language
		if (!$settingsStore.userLanguage)
			$settingsStore.userLanguage = detectLocale(
				'en',
				['en', 'de', 'zh-cn', 'es', 'fr', 'pt-br', 'ja', 'tr', 'vi'],
				navigatorDetector
			) as Locales;

		loadLocale($settingsStore.userLanguage);
		setLocale($settingsStore.userLanguage);

		// Migrate old server settings to new format
		const settingsLocalStorage = localStorage.getItem(StorageKey.HollamaPreferences);
		if (settingsLocalStorage) {
			const settings = JSON.parse(settingsLocalStorage);

			if (settings.ollamaServer || settings.openaiServer) {
				// Migrate Ollama server settings
				if (settings.ollamaServer) {
					console.warn('Migrating Ollama server settings');
					serversStore.update((servers) => [
						...servers,
						{
							...getDefaultServer(ConnectionType.Ollama),
							baseUrl: settings.ollamaServer
						}
					]);

					delete settings.ollamaServer;
					delete settings.ollamaModel;
					delete settings.ollamaServerStatus;
					delete settings.ollamaModels;
				}

				// Migrate OpenAI server settings
				if (settings.openaiServer) {
					console.warn('Migrating OpenAI server settings');
					serversStore.update((servers) => [
						...servers,
						{
							...getDefaultServer(ConnectionType.OpenAI),
							baseUrl: settings.openaiServer
						}
					]);

					delete settings.openaiServer;
					delete settings.openaiApiKey;
				}

				// Reset the settings store with the removed keys
				localStorage.removeItem(StorageKey.HollamaPreferences);
				settingsStore.set(settings);

				// Ask the user to re-verify the server connections
				toast.warning($LL.serverSettingsUpdated());
			}
		}

		// Strip credentials from server configs (privacy migration). apiKey and
		// extraHeaders are legacy fields not on the current Server type, so they
		// are accessed/deleted through a widened shape.
		const currentServers = $serversStore;
		const hasCredentials = currentServers.some((s) => 'apiKey' in s || 'extraHeaders' in s);
		if (hasCredentials) {
			serversStore.update((servers) =>
				servers.map((s) => {
					const cleaned: Server & { apiKey?: unknown; extraHeaders?: unknown } = { ...s };
					delete cleaned.apiKey;
					delete cleaned.extraHeaders;
					return cleaned;
				})
			);
			toast.warning(
				'Credentials have been removed from browser storage for privacy. Please re-enter them in Settings > Servers.'
			);
		}

		// Color theme
		if (browser && !$settingsStore.userTheme) {
			$settingsStore.userTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light';
		}
	});
</script>

<Toaster
	toastOptions={{
		unstyled: true,
		classes: {
			toast:
				'shadow-xl px-4 py-3 flex items-center gap-x-3 max-w-full w-full rounded mx-auto text-xs mx-0',
			loading: 'bg-shade-0',
			error: 'text-red-50 bg-red-700',
			success: 'text-emerald-50 bg-emerald-700',
			warning: 'text-yellow-50 bg-yellow-700',
			info: 'bg-shade-1 text-neutral-500'
		}
	}}
	position="top-center"
/>

<div class="relative flex h-dvh w-screen bg-shade-2 lg:p-4">
	<CollapsibleSidebar />
	<div class="relative flex-1">
		<SidebarToggle />
		{@render children()}
	</div>
</div>

<style lang="postcss">
	:global(html) {
		@apply fixed bg-shade-0 text-base tracking-normal;
		@apply text-base lg:bg-shade-2;
	}
</style>
