<script lang="ts">
	import { Files } from 'lucide-svelte';

	import LL from '$i18n/i18n-svelte';
	import { copyToClipboard } from '$lib/clipboard';

	import Button from './Button.svelte';

	export let content: string;
	export let dataTestid: string | undefined = undefined;

	function copyContent() {
		copyToClipboard(content);
	}
</script>

<div class="copy-button" data-testid={dataTestid}>
	<Button title={$LL.copy()} variant="icon" on:click={copyContent}>
		<Files class="base-icon" />
	</Button>
</div>

<style lang="postcss">
	.copy-button {
		/* Always rendered. Clipboard copy also works without a hover-capable
		   pointer (see the execCommand fallback in copyContent), so there is no
		   reason to hide the button when `hover: hover` doesn't match — doing so
		   previously made the copy button vanish entirely on touchscreens and on
		   virtual/remote displays (e.g. some Electron setups). Hover-reveal for
		   per-message/code buttons is handled separately via opacity, which keeps
		   the desktop declutter without hiding the control from layout. */
		display: unset;
	}
</style>
