<script lang="ts">
	import { Brain } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import Button from '$lib/components/Button.svelte';
	import { generateNewUrl } from '$lib/components/ButtonNew';
	import FieldSelect from '$lib/components/FieldSelect.svelte';
	import { type Knowledge } from '$lib/knowledge';
	import { Sitemap } from '$lib/sitemap';

	interface Props {
		value?: string;
		options?: Knowledge[];
		showNav?: boolean;
		showLabel?: boolean;
		allowClear?: boolean;
		onChange?: (knowledgeId: string) => void;
		fieldId?: string;
	}

	let {
		value = $bindable(undefined),
		options = [],
		showNav = false,
		showLabel = true,
		allowClear = true,
		onChange = undefined,
		fieldId = 'knowledge'
	}: Props = $props();
</script>

<FieldSelect
	bind:value
	label={$LL.knowledge()}
	isLabelVisible={showLabel}
	name={fieldId}
	disabled={!options.length}
	placeholder={!options.length ? $LL.emptyKnowledge() : !showLabel ? $LL.knowledge() : ''}
	options={options?.map((k) => ({ value: k.id, label: k.name }))}
	onChange={(option) => onChange?.(option.value)}
	{allowClear}
>
	<svelte:fragment slot="nav">
		{#if showNav}
			<Button
				aria-label={$LL.newKnowledge()}
				variant="outline"
				href={generateNewUrl(Sitemap.KNOWLEDGE)}
				class="h-full text-muted"
			>
				<Brain class="base-icon" />
			</Button>
		{/if}
	</svelte:fragment>
</FieldSelect>
