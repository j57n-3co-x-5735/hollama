import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { basename, extname, join } from 'node:path';

/** Parses the colon-separated HOLLAMA_FILES_DIR env var (matching Unix PATH
 * convention) and canonicalizes each entry. Entries that don't exist or
 * aren't accessible are dropped with a warning rather than failing startup
 * — matches the CSP token-dropping pattern in hooks.server.ts. */
function parseFilesDirEnv(raw: string | undefined): string[] {
	if (!raw) return [];

	const entries = raw.split(':').filter(Boolean);
	const resolved: string[] = [];
	for (const entry of entries) {
		try {
			resolved.push(realpathSync(entry));
		} catch {
			console.warn(
				`HOLLAMA_FILES_DIR: dropped "${entry}" — directory does not exist or is not accessible`
			);
		}
	}
	return resolved;
}

// The env-supplied roots, parsed once at module load. These are the DEFAULT /
// fallback; a UI-set override (getAllowedFileDirs) takes precedence at runtime so
// the source folder can be changed from Settings without restarting the app.
export const ALLOWED_FILE_DIRS: string[] = parseFilesDirEnv(process.env.HOLLAMA_FILES_DIR);

// UI-set source-directory override, persisted server-side (localStorage can't
// reach the server). Mirrors credentials.ts: a JSON file under HOLLAMA_DATA_DIR,
// atomic temp+rename, 0o600. Read fresh per request so a Settings change applies
// immediately — no Electron IPC / relaunch needed.
// Resolved per call (not captured at module load) so a runtime env change is
// honored and tests can point HOLLAMA_DATA_DIR at a scratch dir without
// re-importing the module. In production the value is stable.
function dataDir(): string {
	return process.env.HOLLAMA_DATA_DIR || join(process.cwd(), '.hollama');
}
function configFilePath(): string {
	return join(dataDir(), 'filesConfig.json');
}

/** Reads the persisted override's directories, or `null` if none is set / it is
 *  empty / unreadable. Stored paths are already realpath-canonical (written by
 *  setFilesDirOverride) and are returned verbatim — we deliberately do NOT
 *  re-realpath on read, so a root that briefly becomes a broken symlink isn't
 *  silently dropped (validateFilePath re-resolves the actual target per request
 *  anyway, which is where escapes are caught). */
function readOverrideDirs(): string[] | null {
	try {
		const file = configFilePath();
		if (!existsSync(file)) return null;
		const parsed = JSON.parse(readFileSync(file, 'utf-8'));
		const dirs = parsed?.dirs;
		if (Array.isArray(dirs) && dirs.length > 0 && dirs.every((d) => typeof d === 'string')) {
			return dirs as string[];
		}
	} catch (err) {
		console.warn('files-dir override unreadable, falling back to HOLLAMA_FILES_DIR:', err);
	}
	return null;
}

/** The effective allowed roots for THIS request: the UI override if set, else the
 *  HOLLAMA_FILES_DIR env roots. Every /api/files* handler snapshots this ONCE at
 *  the top and threads it through resolution + all containment checks, so the
 *  resolver and the validator can never read different allowlists. */
export function getAllowedFileDirs(): string[] {
	return readOverrideDirs() ?? ALLOWED_FILE_DIRS;
}

export type FilesDirSource = 'override' | 'env' | 'none';

/** Current config for the settings UI: the effective dirs and where they came
 *  from. Desktop-only callers may show absolute paths (the user is the operator);
 *  the /api/files/config route enforces that gate. */
export function readFilesDirConfig(): { dirs: string[]; source: FilesDirSource } {
	const override = readOverrideDirs();
	if (override) return { dirs: override, source: 'override' };
	if (ALLOWED_FILE_DIRS.length > 0) return { dirs: ALLOWED_FILE_DIRS, source: 'env' };
	return { dirs: [], source: 'none' };
}

export interface SetFilesDirResult {
	ok: boolean;
	dirs: string[];
	/** Entries that don't exist or aren't directories (validation failures). */
	invalid: string[];
}

/** Persists a UI-chosen set of source directories. Each entry is realpath-
 *  canonicalized and confirmed to be a directory; invalid entries are reported
 *  and NOT stored. A caller that sends only invalid entries fails (ok:false)
 *  rather than silently clearing. An explicitly empty list clears the override,
 *  reverting to HOLLAMA_FILES_DIR. Atomic temp+rename, 0o600. */
export function setFilesDirOverride(rawDirs: string[]): SetFilesDirResult {
	const canonical: string[] = [];
	const invalid: string[] = [];
	let sawNonEmpty = false;
	for (const entry of rawDirs) {
		const trimmed = typeof entry === 'string' ? entry.trim() : '';
		if (!trimmed) continue;
		sawNonEmpty = true;
		try {
			const real = realpathSync(trimmed);
			if (!statSync(real).isDirectory()) {
				invalid.push(entry);
				continue;
			}
			if (!canonical.includes(real)) canonical.push(real);
		} catch {
			invalid.push(entry);
		}
	}

	if (canonical.length === 0) {
		// All entries invalid → error (don't wipe the current config on a typo).
		if (sawNonEmpty) return { ok: false, dirs: [], invalid };
		// Genuinely empty input → clear the override (back to env).
		clearFilesDirOverride();
		return { ok: true, dirs: [], invalid };
	}

	try {
		const dir = dataDir();
		const file = configFilePath();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const tmp = file + '.tmp';
		writeFileSync(tmp, JSON.stringify({ dirs: canonical }, null, 2), {
			mode: 0o600,
			encoding: 'utf-8'
		});
		renameSync(tmp, file);
	} catch (err) {
		console.warn('Failed to persist files-dir override:', err);
		return { ok: false, dirs: [], invalid };
	}
	return { ok: true, dirs: canonical, invalid };
}

export function clearFilesDirOverride(): void {
	try {
		rmSync(configFilePath(), { force: true });
	} catch (err) {
		console.warn('Failed to clear files-dir override:', err);
	}
}

/** Client-facing view of the configured roots: basename + index only, never the
 * absolute path. Returning absolute paths would disclose the server's directory
 * layout (and often the OS username via `/home/<user>/…`) to any origin-matching
 * caller. The client navigates by index + relative path instead, so absolute
 * paths stay server-side. */
export function rootsForClient(allowedDirs: string[]): { name: string; index: number }[] {
	return allowedDirs.map((dir, index) => ({ name: basename(dir) || dir, index }));
}

/** Resolves a client-supplied (rootIndex, relativePath) pair to an absolute path
 * inside the configured root, or null if the index is out of range. The result
 * MUST still be passed through validateFilePath() (containment, symlink
 * resolution, dotfile checks) before any filesystem use — this only performs the
 * index bounds check and the join. */
export function resolveRootRelative(
	allowedDirs: string[],
	rootRaw: string | null,
	rel: string | null
): string | null {
	if (rootRaw === null) return null;
	const index = Number(rootRaw);
	if (!Number.isInteger(index) || index < 0 || index >= allowedDirs.length) return null;
	return join(allowedDirs[index], rel ?? '');
}

/** Parses the optional HOLLAMA_FILES_ALLOWED_EXTENSIONS env var — a
 * comma-separated list of file extensions the content route is permitted to
 * read (e.g. ".txt,.md,json"). Each entry is lowercased and normalized to a
 * leading-dot form, so ".TXT", "txt", and ".txt" are equivalent. An empty or
 * unset value means no restriction: any file that clears the path-security
 * layers and the binary sniff may be read. This is a defense-in-depth layer on
 * the content route for operator-controlled (e.g. Docker/self-hosted)
 * deployments. */
export function parseExtensionsEnv(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean)
		.map((e) => (e.startsWith('.') ? e : `.${e}`));
}

export const ALLOWED_FILE_EXTENSIONS: string[] = parseExtensionsEnv(
	process.env.HOLLAMA_FILES_ALLOWED_EXTENSIONS
);

/** Decides whether a file may be read given the configured extension allowlist.
 * An empty allowlist means "no restriction" (feature off). When an allowlist is
 * configured, the file's extension (lowercased, from its canonical path) must
 * appear in it — extensionless files are therefore rejected under an active
 * allowlist, which is the intended conservative behavior. Kept as a pure
 * function so it can be unit-tested exhaustively without a running server,
 * mirroring the validateFilePath testing approach. */
export function isExtensionAllowed(canonicalPath: string, allowedExtensions: string[]): boolean {
	if (allowedExtensions.length === 0) return true;
	return allowedExtensions.includes(extname(canonicalPath).toLowerCase());
}
