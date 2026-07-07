import { get } from 'svelte/store';

import { filesStore } from '$lib/localStorage';
import { generateRandomId } from '$lib/utils';

export interface FileReference {
	id: string;
	/** Display name (basename). */
	name: string;
	persistentlySelected: boolean;
	/** New references locate the file by its root index + path relative to that
	 * root, so absolute server paths never reach the client. */
	rootIndex?: number;
	rel?: string;
	/** Legacy references carried an absolute path; still resolvable at send time
	 * via the content route's back-compat `path` param. */
	path?: string;
}

export function addFileReference(
	rootIndex: number,
	rel: string,
	name: string,
	persistent: boolean
): FileReference {
	const reference: FileReference = {
		id: generateRandomId(),
		rootIndex,
		rel,
		name,
		persistentlySelected: persistent
	};
	filesStore.update((files) => [...files, reference]);
	return reference;
}

/** Builds the content-route query string for a reference — the new
 * root-index/relative form, or the legacy absolute path. */
export function fileContentQuery(file: FileReference): string {
	if (file.rootIndex !== undefined) {
		return `root=${file.rootIndex}&rel=${encodeURIComponent(file.rel ?? '')}`;
	}
	return `path=${encodeURIComponent(file.path ?? '')}`;
}

export function removeFileReference(id: string): void {
	filesStore.update((files) => files.filter((f) => f.id !== id));
}

export function togglePersistence(id: string): void {
	filesStore.update((files) =>
		files.map((f) => (f.id === id ? { ...f, persistentlySelected: !f.persistentlySelected } : f))
	);
}

/** Returns the current list of files marked to attach to every message,
 * used by Prompt.svelte to auto-attach persistent files on session load. */
export function getPersistentFiles(): FileReference[] {
	return get(filesStore).filter((f) => f.persistentlySelected);
}
