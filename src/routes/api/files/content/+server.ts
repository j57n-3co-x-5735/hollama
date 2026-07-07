import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/public';
import {
	ALLOWED_FILE_EXTENSIONS,
	getAllowedFileDirs,
	isExtensionAllowed,
	resolveRootRelative
} from '$lib/server/filesConfig';
import {
	checkOrigin,
	containsDotfileSegment,
	filePathErrorStatus,
	validateFilePath
} from '$lib/server/validation';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 1024;

export async function GET({ request, url }) {
	const isDesktop = env.PUBLIC_ADAPTER === 'electron-node';
	if (!isDesktop) {
		const originError = checkOrigin(request);
		if (originError) return originError;
	}

	// New references identify a file by (root index + relative path) so the
	// client never handles absolute server paths; legacy references (and the
	// unit/integration tests) still pass an absolute `path`. Both resolve to an
	// absolute path that then goes through validateFilePath() below.
	// Snapshot the effective roots ONCE (UI override or env fallback) so resolution
	// and validation below use the same allowlist.
	const allowedDirs = getAllowedFileDirs();

	const rootRaw = url.searchParams.get('root');
	const pathRaw = url.searchParams.get('path');
	let target: string;
	if (rootRaw !== null) {
		const resolved = resolveRootRelative(allowedDirs, rootRaw, url.searchParams.get('rel'));
		if (resolved === null) return json({ error: 'Access denied' }, { status: 403 });
		target = resolved;
	} else if (pathRaw) {
		target = pathRaw;
	} else {
		return json({ error: 'path query parameter is required' }, { status: 400 });
	}

	const result = validateFilePath(target, allowedDirs);
	if (result.error !== null) {
		return json({ error: result.error }, { status: filePathErrorStatus(result.error) });
	}
	const { canonicalPath } = result;

	// Dotfiles are excluded from directory listings; without this check the
	// content route would still serve them by direct path (e.g. .env, .ssh
	// keys). Judged against the canonical path so a symlink can't smuggle one
	// in. Returns the same generic 'Access denied' as an out-of-tree path.
	if (containsDotfileSegment(canonicalPath, allowedDirs)) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	// Optional operator-configured extension allowlist (N4). When set, only the
	// listed extensions may be read; anything else — including extensionless
	// files — is rejected before we ever open the fd. Judged against the
	// canonical (post-symlink-resolution) path so a symlinked ".txt" pointing at
	// a real ".pdf" is evaluated by its true target.
	if (!isExtensionAllowed(canonicalPath, ALLOWED_FILE_EXTENSIONS)) {
		return json({ error: 'File type not allowed' }, { status: 403 });
	}

	// Open the fd once and operate on it exclusively from here on — this pins
	// the inode, so a symlink swap between validateFilePath's realpathSync
	// and this read can't redirect us to a different file (TOCTOU).
	let fd: number;
	try {
		fd = openSync(canonicalPath, 'r');
	} catch {
		return json({ error: 'Path not accessible' }, { status: 404 });
	}

	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) {
			return json({ error: 'Path is not a file' }, { status: 400 });
		}
		if (stat.size > MAX_FILE_SIZE_BYTES) {
			return json({ error: 'File too large' }, { status: 413 });
		}

		const buffer = readFileSync(fd);
		const sample = buffer.subarray(0, Math.min(BINARY_SNIFF_BYTES, buffer.length));

		const hasNullByte = sample.includes(0);
		let isValidUtf8 = true;
		if (!hasNullByte) {
			try {
				new TextDecoder('utf-8', { fatal: true }).decode(sample);
			} catch {
				isValidUtf8 = false;
			}
		}
		if (hasNullByte || !isValidUtf8) {
			return json({ error: 'Binary files cannot be read as text' }, { status: 415 });
		}

		return new Response(buffer.toString('utf-8'), {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'no-store'
			}
		});
	} finally {
		closeSync(fd);
	}
}
