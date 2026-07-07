<script lang="ts">
	import { LoaderCircle } from 'lucide-svelte';
	import Trash_2 from 'lucide-svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';

	import LL from '$i18n/i18n-svelte';
	import { OllamaStrategy } from '$lib/chat/ollama';
	import { OpenAIStrategy } from '$lib/chat/openai';
	import Badge from '$lib/components/Badge.svelte';
	import Button from '$lib/components/Button.svelte';
	import FieldCheckbox from '$lib/components/FieldCheckbox.svelte';
	import FieldHelp from '$lib/components/FieldHelp.svelte';
	import FieldInput from '$lib/components/FieldInput.svelte';
	import Fieldset from '$lib/components/Fieldset.svelte';
	import P from '$lib/components/P.svelte';
	import { ConnectionType, type Server } from '$lib/connections';
	import { serversStore } from '$lib/localStorage';

	import ExtraHeaders from './ExtraHeaders.svelte';
	import OllamaBaseURLHelp from './ollama/BaseURLHelp.svelte';
	import PullModel from './ollama/PullModel.svelte';

	interface Props {
		index: number;
		/** Whether the server has an OPENAI_API_KEY env var set. Probed once
		 *  at the parent level so multiple Connection components don't fire
		 *  per-instance /api/metadata fetches. */
		hasServerApiKey: boolean;
		/** Whether this is the desktop (Electron) build. Keyless (blank-key)
		 *  OpenAI-Compatible connections only work there — the backend allows
		 *  keyless proxying to a local (loopback) server on desktop only. */
		isDesktop: boolean;
	}

	let { index, hasServerApiKey, isDesktop }: Props = $props();
	let server: Server = $state($serversStore[index]);
	let strategy: OllamaStrategy | OpenAIStrategy;
	let isLoading = $state(false);

	let localApiKey = $state('');
	let localExtraHeaders: Record<string, string> = $state({});

	// LM Studio speaks the OpenAI protocol (so it uses OpenAIStrategy and the
	// same proxy paths as the OpenAI family) but is a keyless local server — the
	// entire API-key UI is suppressed for it (see the key-field guards below).
	const isLMStudio = $derived(server.connectionType === ConnectionType.LMStudio);
	const isOpenAiFamily = $derived(
		[ConnectionType.OpenAI, ConnectionType.OpenAICompatible, ConnectionType.LMStudio].includes(
			server.connectionType
		)
	);
	const isOllamaFamily = $derived([ConnectionType.Ollama].includes(server.connectionType));

	$effect(() => {
		serversStore.update((servers) => {
			servers.splice(index, 1, server);
			return servers;
		});
	});

	$effect(() => {
		if (server.connectionType !== ConnectionType.OpenAICompatible) {
			server.sessionAffinityKey = undefined;
		}
	});

	async function submitCredentials(): Promise<boolean> {
		if (!isOpenAiFamily) return true;
		const key = localApiKey.trim();
		if (hasServerApiKey && !key) return true;
		if (!key) {
			// Keyless (blank key) is valid for an OpenAI-Compatible OR LM Studio
			// connection on desktop, where the backend allows keyless proxying to a
			// local (loopback) server. LM Studio has no key field at all, so it
			// always takes this path. Everywhere else a key is required.
			if ((server.connectionType === ConnectionType.OpenAICompatible || isLMStudio) && isDesktop) {
				// A previous verify may have stored a key server-side; drop it so
				// clearing the field and re-verifying makes the connection truly
				// keyless (rather than silently reusing the stored credential).
				// AWAIT the delete: an un-awaited delete can still be in flight when
				// verifyServer() → getModels() → the proxy resolves the OLD stored
				// key, letting a "keyless" verify pass on a credential that's about
				// to be removed.
				try {
					await fetch('/api/keys', {
						method: 'DELETE',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ baseUrl: server.baseUrl })
					});
				} catch {
					// Ignore delete failures — proceed keyless regardless.
				}
				return true;
			}
			return false;
		}

		try {
			const body: Record<string, unknown> = {
				baseUrl: server.baseUrl,
				apiKey: key
			};
			if (Object.keys(localExtraHeaders).length > 0) {
				body.extraHeaders = localExtraHeaders;
			}
			const res = await fetch('/api/keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async function verifyServer() {
		isLoading = true;
		const toastId = toast.loading($LL.connecting());

		if (isOpenAiFamily) {
			const credOk = await submitCredentials();
			if (!credOk) {
				toast.error($LL.apiKeyRequired(), { id: toastId });
				isLoading = false;
				return;
			}
		}

		strategy = isOpenAiFamily ? new OpenAIStrategy(server) : new OllamaStrategy(server);
		try {
			await strategy.verifyServer();
			server.isVerified = new Date();
			server.isEnabled = true;
			localApiKey = '';
			// Mirror localApiKey clearance for extraHeaders: if the user
			// re-verifies, the previous headers would otherwise silently
			// re-submit alongside the next credential.
			localExtraHeaders = {};
			toast.success($LL.connectionIsVerified(), { id: toastId });
		} catch (e) {
			server.isVerified = null;
			toast.error(e instanceof Error ? e.message : $LL.connectionFailedToVerify(), {
				id: toastId
			});
		}
		isLoading = false;
	}

	function deleteServer() {
		if (isOpenAiFamily && server.baseUrl) {
			fetch('/api/keys', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ baseUrl: server.baseUrl })
			}).catch(() => {});
		}
		serversStore.update((servers) => servers.filter((s) => s.id !== server.id));
	}
</script>

<div data-testid="server">
	<Fieldset>
		{#snippet legend()}
			{#if [ConnectionType.OpenAI, ConnectionType.Ollama].includes(server.connectionType)}
				<Badge
					variant={server.connectionType === ConnectionType.OpenAI
						? ConnectionType.OpenAI
						: ConnectionType.Ollama}
				/>
			{/if}
			<Badge>
				{server.label
					? server.label
					: isLMStudio
						? $LL.lmStudio()
						: server.connectionType?.toUpperCase()}
			</Badge>
		{/snippet}

		<Fieldset>
			<nav class="flex items-stretch gap-x-2">
				<FieldCheckbox label={$LL.useModelsFromThisServer()} bind:checked={server.isEnabled} />

				<Button
					class="max-h-full"
					variant="outline"
					on:click={deleteServer}
					aria-label={$LL.deleteServer()}
				>
					<Trash_2 class="base-icon" />
				</Button>

				<Button
					disabled={isLoading || !server.baseUrl}
					variant={!server.isVerified ? 'default' : 'outline'}
					on:click={verifyServer}
				>
					{#if isLoading}
						<LoaderCircle class="base-icon animate-spin" />
					{:else}
						{server.isVerified ? $LL.reVerify() : $LL.verify()}
					{/if}
				</Button>
			</nav>

			<div class="flex flex-col gap-2 sm:grid sm:grid-cols-2">
				<div
					class="col-span-2 grid gap-2 {isOpenAiFamily && !isLMStudio
						? 'sm:grid sm:grid-cols-2'
						: ''}"
				>
					<FieldInput
						name={`server-${server.id}`}
						label={$LL.baseUrl()}
						placeholder={server.baseUrl}
						bind:value={server.baseUrl}
					>
						<svelte:fragment slot="help">
							{#if isOllamaFamily}
								<OllamaBaseURLHelp {server} />
							{:else if isLMStudio}
								<FieldHelp>
									<P>{$LL.lmStudioBaseURLHelp()}</P>
								</FieldHelp>
							{/if}
						</svelte:fragment>
					</FieldInput>

					{#if isOpenAiFamily && !isLMStudio && !hasServerApiKey}
						<FieldInput
							type="password"
							name={`apiKey-${server.id}`}
							label={$LL.apiKey()}
							bind:value={localApiKey}
							placeholder={server.connectionType === ConnectionType.OpenAICompatible
								? $LL.apiKeyOptionalPlaceholder()
								: $LL.apiKeyPlaceholder()}
						>
							<svelte:fragment slot="help">
								{#if server.connectionType === 'openai'}
									<FieldHelp>
										<P>
											<Button
												variant="link"
												href="https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key"
												target="_blank"
											>
												{$LL.howToObtainOpenAIKey()}
											</Button>
										</P>
									</FieldHelp>
								{:else if server.connectionType === ConnectionType.OpenAICompatible}
									<FieldHelp>
										<P>{$LL.apiKeyOptionalHelp()}</P>
									</FieldHelp>
								{/if}
							</svelte:fragment>
						</FieldInput>
					{:else if isOpenAiFamily && !isLMStudio && hasServerApiKey}
						<FieldHelp>
							<P>{$LL.apiKeyServerSideConfigured()}</P>
						</FieldHelp>
					{/if}
				</div>
				<FieldInput
					name={`modelsFilter-${server.id}`}
					label={$LL.modelsFilter()}
					placeholder="gpt"
					bind:value={server.modelFilter}
				>
					<svelte:fragment slot="help">
						<FieldHelp>
							<P>
								{$LL.modelsFilterHelp()}
							</P>
						</FieldHelp>
					</svelte:fragment>
				</FieldInput>

				<FieldInput
					name={`label-${server.id}`}
					label={$LL.label()}
					bind:value={server.label}
					placeholder="my-llama-server"
				>
					<svelte:fragment slot="help">
						<FieldHelp>
							<P>{$LL.connectionLabelHelp()}</P>
						</FieldHelp>
					</svelte:fragment>
				</FieldInput>
			</div>

			{#if server.connectionType === ConnectionType.OpenAICompatible}
				<FieldInput
					name={`sessionAffinityKey-${server.id}`}
					label={$LL.sessionAffinityKey()}
					placeholder={$LL.sessionAffinityKeyPlaceholder()}
					bind:value={server.sessionAffinityKey}
				>
					<svelte:fragment slot="help">
						<FieldHelp>
							<P>{$LL.sessionAffinityKeyHelp()}</P>
						</FieldHelp>
					</svelte:fragment>
				</FieldInput>
			{/if}

			{#if isOpenAiFamily && !isLMStudio}
				<ExtraHeaders headers={localExtraHeaders} onchange={(h) => (localExtraHeaders = h)} />
			{/if}

			{#if isOllamaFamily}
				<PullModel {server} />
			{/if}
		</Fieldset>
	</Fieldset>
</div>
