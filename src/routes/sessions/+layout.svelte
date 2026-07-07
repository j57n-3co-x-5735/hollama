<script lang="ts">
	import { type Snippet } from 'svelte';
	import { get } from 'svelte/store';

	import { browser } from '$app/environment';
	import { getLastUsedModels } from '$lib/chat';
	import { OllamaStrategy } from '$lib/chat/ollama';
	import { OpenAIStrategy } from '$lib/chat/openai';
	import RobotsNoIndex from '$lib/components/RobotsNoIndex.svelte';
	import { ConnectionType } from '$lib/connections';
	import { serversStore, settingsStore } from '$lib/localStorage';
	import { type Model } from '$lib/settings';

	let { children }: { children: Snippet } = $props();

	async function listModels(): Promise<Model[]> {
		const models: Model[] = [];
		// Last-known-good model list. Read non-reactively with get(): reading
		// $settingsStore here would make this effect depend on the very store it
		// writes to, creating an update loop.
		const previousModels = get(settingsStore)?.models ?? [];

		for (const server of $serversStore) {
			if (!server.isEnabled) continue;

			try {
				switch (server.connectionType) {
					case ConnectionType.Ollama:
						models.push(...(await new OllamaStrategy(server).getModels()));
						break;
					case ConnectionType.OpenAI:
					case ConnectionType.OpenAICompatible:
					case ConnectionType.LMStudio:
						models.push(...(await new OpenAIStrategy(server).getModels()));
						break;
				}
			} catch (e) {
				console.error('[models]', server.baseUrl, e instanceof Error ? e.message : e);
				// Preserve this server's last-known-good models on a transient fetch
				// failure. Otherwise a momentary error (server briefly unreachable,
				// slow proxy, network blip) wipes settingsStore.models to empty,
				// which DISABLES the model picker — the user then can't type into it
				// to filter or select any model until a refresh happens to succeed.
				models.push(...previousModels.filter((m) => m.serverId === server.id));
			}
		}

		return models.sort((a, b) => {
			const nameA = a.name;
			const nameB = b.name;
			return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
		});
	}

	$effect(() => {
		if (browser) {
			listModels().then((models) => {
				$settingsStore.models = models;
				$settingsStore.lastUsedModels = getLastUsedModels();
			});
		}
	});
</script>

<RobotsNoIndex />

<div class="flex h-full w-full">
	<main class="flex min-w-0 flex-1 flex-col bg-shade-1 lg:rounded-xl lg:border">
		<div class="flex-1 overflow-auto">
			{@render children()}
		</div>
	</main>
</div>
