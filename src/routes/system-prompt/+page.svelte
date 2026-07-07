<script lang="ts">
	import LL from '$i18n/i18n-svelte';
	import Head from '$lib/components/Head.svelte';
	import { settingsStore } from '$lib/localStorage';
</script>

<Head title={$LL.globalSystemPrompt()} />

<section class="system-prompt-page">
	<div class="system-prompt-page__content">
		<h1 class="text-lg font-bold">{$LL.globalSystemPrompt()}</h1>
		<p class="text-sm text-muted">{$LL.globalSystemPromptDescription()}</p>
		<textarea
			id="global-system-prompt"
			aria-label={$LL.systemPromptInstructions()}
			class="system-prompt-page__textarea"
			placeholder={$LL.systemPromptPlaceholder()}
			maxlength={10000}
			value={$settingsStore.globalSystemPrompt ?? ''}
			oninput={(e) => ($settingsStore.globalSystemPrompt = e.currentTarget.value)}
		></textarea>
		<p class="text-xs text-muted">{$LL.systemPromptMultipleNote()}</p>
	</div>
</section>

<style lang="postcss">
	.system-prompt-page {
		@apply base-section base-section-fullscreen px-4;
	}

	.system-prompt-page__content {
		@apply my-auto flex w-full max-w-[65ch] flex-col gap-y-3;
	}

	.system-prompt-page__textarea {
		@apply base-input min-h-40 resize-y rounded-md border bg-shade-0 px-3 py-2 text-sm;
		@apply focus:border-shade-6 focus:outline focus:outline-shade-2;
		field-sizing: content;
	}
</style>
