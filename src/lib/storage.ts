import { get } from 'svelte/store';

import { filesStore, foldersStore, knowledgeStore, sessionsStore } from '$lib/localStorage';

/** localStorage's per-origin quota is ~5MB in all major browsers/Electron's
 * Chromium. All Hollama stores share this single origin. */
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

export const STORAGE_WARNING_RATIO = 0.8;
export const STORAGE_BANNER_RATIO = 0.9;
export const STORAGE_BLOCK_RATIO = 0.95;

/** Approximate total bytes used across the Hollama content stores that share
 * the 5MB origin quota: sessions, knowledge, folders, and files. (The tiny
 * settings/servers config stores are excluded — they don't grow with usage.)
 * Byte-based rather than count-based: a session with pasted images or deep
 * reasoning output can be 50-100x larger than a text-only session, so a
 * session-count cap would be wildly inaccurate for image-heavy users. */
export function getStorageUsageBytes(): number {
	const sessions = new Blob([JSON.stringify(get(sessionsStore) ?? [])]).size;
	const knowledge = new Blob([JSON.stringify(get(knowledgeStore) ?? [])]).size;
	const folders = new Blob([JSON.stringify(get(foldersStore) ?? [])]).size;
	const files = new Blob([JSON.stringify(get(filesStore) ?? [])]).size;
	return sessions + knowledge + folders + files;
}

export function formatBytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Shown once per app session (not persisted) — re-checking on every message
// save would otherwise re-toast on every single message once past 80%.
let hasShownWarningToast = false;

export interface StorageCheckResult {
	usedBytes: number;
	ratio: number;
	shouldWarn: boolean;
	shouldBlock: boolean;
}

/** Called from saveSession() on every save. Returns whether this save should
 * be blocked (95%+, new sessions only) and whether a one-time 80% toast
 * should fire. The 90% persistent banner is derived reactively in the UI
 * from getStorageUsageBytes() directly, not from this one-shot check. */
export function checkStorageCapacity(): StorageCheckResult {
	const usedBytes = getStorageUsageBytes();
	const ratio = usedBytes / STORAGE_LIMIT_BYTES;

	const shouldWarn = ratio >= STORAGE_WARNING_RATIO && !hasShownWarningToast;
	if (shouldWarn) hasShownWarningToast = true;

	return { usedBytes, ratio, shouldWarn, shouldBlock: ratio >= STORAGE_BLOCK_RATIO };
}
