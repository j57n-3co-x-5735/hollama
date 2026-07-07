<script lang="ts">
	import LL from '$i18n/i18n-svelte';
	import { version } from '$app/environment';
	import Badge from '$lib/components/Badge.svelte';
	import Fieldset from '$lib/components/Fieldset.svelte';
	import P from '$lib/components/P.svelte';
</script>

<Fieldset>
	<P><strong>{$LL.currentVersion()}</strong></P>
	<Badge>{version}</Badge>
</Fieldset>
