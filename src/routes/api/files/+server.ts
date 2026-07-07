import { opendirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/public';
import { getAllowedFileDirs, resolveRootRelative, rootsForClient } from '$lib/server/filesConfig';
import {
	checkOrigin,
	containsDotfileSegment,
	filePathErrorStatus,
	validateFilePath
} from '$lib/server/validation';

const MAX_DEPTH = 10;
const MAX_ENTRIES = 1000;

interface DirEntry {
	name: string;
	type: 'file' | 'dir';
	size?: number;
	modified?: string;
}

function depthBelowBase(canonicalPath: string, allowedDirs: string[]): number {
	const baseDir = allowedDirs.find(
		(dir) => canonicalPath === dir || canonicalPath.startsWith(dir + '/')
	);
	if (!baseDir) return 0;
	const relative = canonicalPath.slice(baseDir.length).replace(/^\//, '');
	return relative ? relative.split('/').length : 0;
}

export async function GET({ request, url }) {
	const isDesktop = env.PUBLIC_ADAPTER === 'electron-node';
	if (!isDesktop) {
		const originError = checkOrigin(request);
		if (originError) return originError;
	}

	// Snapshot the effective roots ONCE per request (UI override or env fallback)
	// and thread it through resolution + every containment check below, so the
	// resolver and the validator can never read different allowlists.
	const allowedDirs = getAllowedFileDirs();

	const rootRaw = url.searchParams.get('root');
	const dir = url.searchParams.get('dir');

	// Roots bootstrap: no navigation params → return each root's basename + its
	// index, NOT its absolute path. The client navigates by (root index +
	// relative path) so server absolute paths never reach it (they would
	// disclose the OS username / directory layout to any origin-matching caller).
	if (rootRaw === null && !dir) {
		if (allowedDirs.length === 0) {
			return json({ error: 'File access is not configured' }, { status: 403 });
		}
		return json(
			{ roots: rootsForClient(allowedDirs) },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	}

	// Resolve the target absolute path from either the new (root, rel) pair or a
	// legacy absolute `dir` (kept working for back-compat). Either way it then
	// goes through the full validateFilePath() gauntlet below.
	let target: string;
	if (rootRaw !== null) {
		const resolved = resolveRootRelative(allowedDirs, rootRaw, url.searchParams.get('rel'));
		if (resolved === null) return json({ error: 'Access denied' }, { status: 403 });
		target = resolved;
	} else {
		target = dir as string; // guaranteed non-null: the roots-bootstrap branch returned above
	}

	const result = validateFilePath(target, allowedDirs);
	if (result.error !== null) {
		return json({ error: result.error }, { status: filePathErrorStatus(result.error) });
	}
	const { canonicalPath } = result;

	// String-only checks (no filesystem access) run first, on the already-
	// validated canonical path.
	if (depthBelowBase(canonicalPath, allowedDirs) > MAX_DEPTH) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	// Reject listing INTO a dot-directory by direct path (e.g. dir=/allowed/.git)
	// — dotfiles are excluded from listing output below, so allowing navigation
	// into them by direct path would be an inconsistent hole.
	if (containsDotfileSegment(canonicalPath, allowedDirs)) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	// Open the directory as an fd and read its entries from that handle — this
	// pins the inode, so a symlink/dir swap between validateFilePath's
	// realpathSync and the read can't redirect the listing to a different
	// directory (TOCTOU), matching the content route's openSync approach.
	// opendirSync also validates it is a directory (ENOTDIR) and exists (ENOENT).
	let dirHandle;
	try {
		dirHandle = opendirSync(canonicalPath);
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === 'ENOTDIR') {
			return json({ error: 'Path is not a directory' }, { status: 400 });
		}
		return json({ error: 'Path not accessible' }, { status: 404 });
	}

	const dirents: Dirent[] = [];
	try {
		let dirent: Dirent | null;
		while ((dirent = dirHandle.readSync()) !== null) {
			if (!dirent.name.startsWith('.')) dirents.push(dirent); // exclude dotfiles
		}
	} finally {
		dirHandle.closeSync();
	}

	const truncated = dirents.length > MAX_ENTRIES;
	const entries: DirEntry[] = [];
	for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
		const fullPath = join(canonicalPath, dirent.name);

		// Symlinks need their real target resolved: `Dirent.isDirectory()` is
		// false for a symlink even when it points at a directory, which would
		// mislabel a symlinked folder as a plain 'file'. Resolve it, and only
		// surface it if the target stays inside the allowlist — an escaping
		// symlink can't be read via the content route anyway, so listing it
		// would only be misleading.
		if (dirent.isSymbolicLink()) {
			let realPath: string;
			try {
				realPath = realpathSync(fullPath);
			} catch {
				continue; // broken link — skip
			}
			const contained = allowedDirs.some(
				(dir) => realPath === dir || realPath.startsWith(dir + '/')
			);
			if (!contained) continue;
			try {
				const linkStat = statSync(realPath);
				const entry: DirEntry = {
					name: dirent.name,
					type: linkStat.isDirectory() ? 'dir' : 'file'
				};
				if (linkStat.isFile()) {
					entry.size = linkStat.size;
					entry.modified = linkStat.mtime.toISOString();
				}
				entries.push(entry);
			} catch {
				// Target vanished between readlink and stat — skip.
			}
			continue;
		}

		const entry: DirEntry = { name: dirent.name, type: dirent.isDirectory() ? 'dir' : 'file' };
		if (dirent.isFile()) {
			try {
				const entryStat = statSync(fullPath);
				entry.size = entryStat.size;
				entry.modified = entryStat.mtime.toISOString();
			} catch {
				// Entry may have been removed between readdir and stat — omit
				// size/modified rather than failing the whole listing.
			}
		}
		entries.push(entry);
	}

	return json({ entries, truncated }, { headers: { 'Cache-Control': 'no-store' } });
}
