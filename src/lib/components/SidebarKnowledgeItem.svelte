<script lang="ts">
	import LL from '$i18n/i18n-svelte';
	import { page } from '$app/state';
	import { Sitemap } from '$lib/sitemap';

	import ButtonDelete from './ButtonDelete.svelte';
	import Metadata from './Metadata.svelte';

	interface Props {
		id: string;
		title: string;
		subtitle: string;
	}

	let { id, title, subtitle }: Props = $props();
	let isDeleting = $state(false);
</script>

<!-- Need to use `#key id` to re-render the delete nav after deletion -->
{#key id}
	<div
		class="section-list-item"
		class:section-list-item--active={page.url.pathname.includes(id)}
		class:section-list-item--confirm-deletion={isDeleting}
	>
		<a
			class="section-list-item__a"
			data-testid="knowledge-item"
			aria-label={$LL.knowledge() + `: ${id}`}
			href={`/${Sitemap.KNOWLEDGE}/${id}`}
		>
			<p class="section-list-item__title">
				{title}
			</p>
			<Metadata>
				{subtitle}
			</Metadata>
		</a>
		<nav
			class="section-list-item__actions"
			class:section-list-item__actions--confirm-deletion={isDeleting}
		>
			<ButtonDelete sitemap={Sitemap.KNOWLEDGE} {id} bind:shouldConfirmDeletion={isDeleting} />
		</nav>
	</div>
{/key}

<style lang="postcss">
	.section-list-item {
		@apply flex flex-row items-center justify-between border-b pr-3;
		@apply last:border-b-0;

		&--confirm-deletion {
			@apply confirm-deletion;
		}
	}

	.section-list-item:hover .section-list-item__actions {
		@apply visible opacity-100;
	}

	.section-list-item__actions {
		@apply invisible flex flex-row items-center opacity-0;
	}

	.section-list-item__actions--confirm-deletion {
		@apply visible opacity-100;
	}

	.section-list-item--active {
		@apply bg-shade-0;
	}

	.section-list-item__a {
		@apply relative z-0 w-full overflow-hidden text-ellipsis py-3 pl-5 pr-0;
		@apply hover:text-active;
	}

	.section-list-item__title {
		@apply max-w-full truncate whitespace-nowrap text-sm font-bold;
	}
</style>
