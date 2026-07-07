<script lang="ts">
	import { onMount } from 'svelte';

	import Button from '$lib/components/Button.svelte';
	import Fieldset from '$lib/components/Fieldset.svelte';
	import P from '$lib/components/P.svelte';

	// The file picker's source folder is a server-side setting (the browser's
	// localStorage can't reach the SvelteKit server), and it only makes sense in
	// the desktop app, where the user runs the server on their own machine. The
	// /api/files/config route 403s on web/docker, and this section hides itself
	// there. Changes apply immediately — the files routes read the config live.
	let isDesktop = $state(false);
	let source = $state(''); // colon-separated absolute paths, mirroring HOLLAMA_FILES_DIR
	let configSource = $state<'override' | 'env' | 'none'>('none');
	let isSaving = $state(false);
	let status = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	onMount(async () => {
		try {
			const meta = await (await fetch('/api/metadata')).json();
			isDesktop = !!meta.isDesktop;
		} catch {
			// ignore — section stays hidden if metadata is unreachable
		}
		if (!isDesktop) return;
		try {
			const r = await fetch('/api/files/config');
			if (r.ok) {
				const c = await r.json();
				source = (c.dirs ?? []).join(':');
				configSource = c.source ?? 'none';
			}
		} catch {
			// ignore — leave the field blank
		}
	});

	async function save() {
		isSaving = true;
		status = null;
		const dirs = source
			.split(':')
			.map((s) => s.trim())
			.filter(Boolean);
		try {
			const r = await fetch('/api/files/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dirs })
			});
			const data = await r.json();
			if (r.ok) {
				source = (data.dirs ?? []).join(':');
				configSource = data.source ?? (data.dirs?.length ? 'override' : 'env');
				status = {
					type: 'success',
					message: dirs.length
						? 'Saved. The new folder is available in the file picker immediately — no restart.'
						: 'Cleared. Reverted to the HOLLAMA_FILES_DIR environment variable (if set).'
				};
			} else {
				status = { type: 'error', message: data.error ?? 'Could not save the source directory.' };
			}
		} catch {
			status = { type: 'error', message: 'Could not save the source directory.' };
		} finally {
			isSaving = false;
		}
	}
</script>

{#if isDesktop}
	<Fieldset>
		<P><strong>Files</strong></P>
		<P>
			Choose which folder the file picker reads from, instead of relying on the
			<code>HOLLAMA_FILES_DIR</code> environment variable. Enter an absolute path (separate multiple
			folders with a colon <code>:</code>). Leave blank to fall back to the environment variable, or
			to disable file access if none is set.
		</P>

		<div class="files-dir">
			<label class="files-dir__label" for="files-source-dir">Source folder</label>
			<input
				id="files-source-dir"
				class="base-input"
				type="text"
				placeholder="/home/you/Documents"
				bind:value={source}
				data-testid="files-source-dir"
			/>
			<div class="files-dir__actions">
				{#if configSource === 'env'}
					<span class="files-dir__hint">Currently using the environment variable.</span>
				{/if}
				<Button disabled={isSaving} on:click={save}>Save</Button>
			</div>
		</div>

		{#if status}
			<P>
				<span class:files-dir__error={status.type === 'error'}>{status.message}</span>
			</P>
		{/if}
	</Fieldset>
{/if}

<style lang="postcss">
	.files-dir {
		@apply flex flex-col gap-2;
	}

	.files-dir__label {
		@apply text-sm font-medium text-muted;
	}

	.files-dir__actions {
		@apply flex items-center justify-end gap-3;
	}

	.files-dir__hint {
		@apply text-xs text-muted;
	}

	.files-dir__error {
		@apply text-red-500;
	}
</style>
