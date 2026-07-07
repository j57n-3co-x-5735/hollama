<script lang="ts">
	import LL from '$i18n/i18n-svelte';
	import { knowledgeStore } from '$lib/localStorage';
	import { formatTimestampToNow } from '$lib/utils';

	import EmptyMessage from './EmptyMessage.svelte';
	import SectionList from './SectionList.svelte';
	import SidebarKnowledgeItem from './SidebarKnowledgeItem.svelte';
</script>

<SectionList>
	{#if $knowledgeStore && $knowledgeStore.length > 0}
		{#each $knowledgeStore as knowledge (knowledge.id)}
			<SidebarKnowledgeItem
				id={knowledge.id}
				title={knowledge.name}
				subtitle={formatTimestampToNow(knowledge.updatedAt)}
			/>
		{/each}
	{:else}
		<EmptyMessage>{$LL.emptyKnowledge()}</EmptyMessage>
	{/if}
</SectionList>
