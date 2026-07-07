import { get } from 'svelte/store';

import { foldersStore, sessionsStore } from '$lib/localStorage';
import { saveSession, type Session } from '$lib/sessions';
import { generateRandomId, getUpdatedAtDate } from '$lib/utils';

export interface Folder {
	id: string;
	name: string;
	isExpanded: boolean;
	sortOrder: number;
	updatedAt: string;
}

export function createFolder(name: string): Folder {
	const currentFolders = get(foldersStore) || [];
	const maxSortOrder = currentFolders.reduce((max, f) => Math.max(max, f.sortOrder), -1);

	const folder: Folder = {
		id: generateRandomId(),
		name,
		isExpanded: true,
		sortOrder: maxSortOrder + 1,
		updatedAt: getUpdatedAtDate()
	};

	foldersStore.set([...currentFolders, folder]);
	return folder;
}

export function renameFolder(id: string, name: string): void {
	foldersStore.update((folders) =>
		folders.map((f) => (f.id === id ? { ...f, name, updatedAt: getUpdatedAtDate() } : f))
	);
}

export function setFolderExpanded(id: string, isExpanded: boolean): void {
	foldersStore.update((folders) => folders.map((f) => (f.id === id ? { ...f, isExpanded } : f)));
}

/** Removes the folder. Sessions that belonged to it are NOT deleted — their
 * `folderId` is cleared so they move to the unfiled group. */
export function deleteFolder(id: string): void {
	foldersStore.update((folders) => folders.filter((f) => f.id !== id));

	const currentSessions = get(sessionsStore) || [];
	currentSessions
		.filter((s) => s.folderId === id)
		.forEach((session) => {
			session.folderId = undefined;
			saveSession(session);
		});
}

export function moveSessionToFolder(sessionId: string, folderId: string | undefined): void {
	const session = get(sessionsStore).find((s) => s.id === sessionId);
	if (!session) return;

	session.folderId = folderId;
	saveSession(session);
}

export interface FoldersWithSessions {
	unfiled: Session[];
	folders: { folder: Folder; sessions: Session[] }[];
}

/** Groups sessions by folder for sidebar rendering. A session whose `folderId`
 * doesn't match any existing folder (e.g. imported from another instance, or
 * left dangling by a prior bug) is treated as unfiled rather than dropped —
 * this prevents phantom empty folder groups or rendering crashes. */
export function getFoldersWithSessions(): FoldersWithSessions {
	const sessions = get(sessionsStore) || [];
	const folders = get(foldersStore) || [];
	const folderIds = new Set(folders.map((f) => f.id));

	const unfiled = sessions.filter((s) => !s.folderId || !folderIds.has(s.folderId));

	const sortedFolders = [...folders].sort(
		(a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
	);

	return {
		unfiled,
		folders: sortedFolders.map((folder) => ({
			folder,
			sessions: sessions.filter((s) => s.folderId === folder.id)
		}))
	};
}
