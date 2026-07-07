import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { containsDotfileSegment, validateFilePath } from '../../src/lib/server/validation';

// Pure-function unit tests — no browser/webServer needed, so these run in
// milliseconds rather than the seconds an E2E page load costs. Integration-
// level HTTP contract coverage lives in files-server.test.ts.
test.describe('validateFilePath', () => {
	let allowedDir: string;
	let outsideDir: string;
	let allowedFile: string;
	let nestedFile: string;
	let symlinkToOutside: string;

	test.beforeAll(() => {
		allowedDir = mkdtempSync(join(tmpdir(), 'hollama-allowed-'));
		outsideDir = mkdtempSync(join(tmpdir(), 'hollama-outside-'));

		allowedFile = join(allowedDir, 'note.txt');
		writeFileSync(allowedFile, 'hello');

		mkdirSync(join(allowedDir, 'subdir'));
		nestedFile = join(allowedDir, 'subdir', 'nested.txt');
		writeFileSync(nestedFile, 'nested');

		writeFileSync(join(outsideDir, 'secret.txt'), 'secret');

		symlinkToOutside = join(allowedDir, 'escape-link');
		try {
			symlinkSync(outsideDir, symlinkToOutside);
		} catch {
			// Symlink creation can be denied by sandboxing on some CI runners;
			// the symlink-escape test below skips itself when this happens.
		}
	});

	test.afterAll(() => {
		rmSync(allowedDir, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
	});

	// --- Layer 0: feature gate ---
	test('L0: rejects any path when no directories are configured', () => {
		expect(validateFilePath(join(allowedDir, 'note.txt'), []).error).toBe(
			'File access is not configured'
		);
	});

	test('L0: takes precedence over an otherwise-valid path', () => {
		expect(validateFilePath('/', []).error).toBe('File access is not configured');
	});

	// --- Layer 1: input presence ---
	test('L1: rejects an empty string', () => {
		expect(validateFilePath('', [allowedDir]).error).toBe('Path is required');
	});

	test('L1: rejects a whitespace-only path', () => {
		expect(validateFilePath('   ', [allowedDir]).error).toBe('Path is required');
	});

	test('L1: rejects a non-string falsy runtime value', () => {
		// @ts-expect-error deliberately exercising the runtime guard with a
		// value the type system would normally reject at the call site.
		expect(validateFilePath(null, [allowedDir]).error).toBe('Path is required');
	});

	// --- Layer 2: null byte injection ---
	test('L2: rejects a path containing a null byte', () => {
		expect(validateFilePath(`${allowedDir}/note.txt\x00.jpg`, [allowedDir]).error).toBe(
			'Path contains invalid characters'
		);
	});

	// --- Layer 3: traversal pattern regex (pre-resolve) ---
	test('L3: rejects literal ../ traversal (OWASP vector)', () => {
		expect(validateFilePath(`${allowedDir}/../../../etc/shadow`, [allowedDir]).error).toBe(
			'Path contains invalid characters'
		);
	});

	test('L3: rejects encoded %2e%2e%2f traversal (OWASP vector)', () => {
		expect(validateFilePath(`${allowedDir}/%2e%2e%2fetc/passwd`, [allowedDir]).error).toBe(
			'Path contains invalid characters'
		);
	});

	test('L3: rejects encoded %5c backslash traversal', () => {
		expect(validateFilePath(`${allowedDir}/foo%5c..%5cbar`, [allowedDir]).error).toBe(
			'Path contains invalid characters'
		);
	});

	// --- Layer 4: absolute path requirement ---
	test('L4: rejects a relative path', () => {
		expect(validateFilePath('relative/path.txt', [allowedDir]).error).toBe(
			'Absolute path required'
		);
	});

	test('L4: rejects a bare filename', () => {
		expect(validateFilePath('passwd', [allowedDir]).error).toBe('Absolute path required');
	});

	// --- Layer 5: canonicalize / existence ---
	test('L5: rejects a path that does not exist (empty path resolving to cwd guard)', () => {
		expect(validateFilePath(join(allowedDir, 'does-not-exist.txt'), [allowedDir]).error).toBe(
			'Path not accessible'
		);
	});

	test('L5: does not leak existence information in the error message', () => {
		const missing = validateFilePath(join(allowedDir, 'nope.txt'), [allowedDir]).error;
		const outside = validateFilePath(join(outsideDir, 'secret.txt'), [allowedDir]).error;
		// Nonexistent (404-class) and existing-but-forbidden (403-class) must
		// produce distinct, non-path-revealing messages — this asserts the
		// 404 case specifically doesn't echo the path back.
		expect(missing).toBe('Path not accessible');
		expect(missing).not.toContain(allowedDir);
		expect(outside).not.toBe(missing);
	});

	// --- Layer 6: containment check (the primary security gate) ---
	test('L6: rejects a path outside all allowed directories', () => {
		expect(validateFilePath(join(outsideDir, 'secret.txt'), [allowedDir]).error).toBe(
			'Access denied'
		);
	});

	test('L6: rejects a sibling directory whose name merely starts with the allowed dir name', () => {
		const evilSibling = `${allowedDir}-evil`;
		mkdirSync(evilSibling, { recursive: true });
		writeFileSync(join(evilSibling, 'file.txt'), 'evil');
		try {
			expect(validateFilePath(join(evilSibling, 'file.txt'), [allowedDir]).error).toBe(
				'Access denied'
			);
		} finally {
			rmSync(evilSibling, { recursive: true, force: true });
		}
	});

	test('L6: accepts the allowed directory itself', () => {
		const result = validateFilePath(allowedDir, [allowedDir]);
		expect(result.error).toBeNull();
	});

	test('L6: accepts a file directly inside an allowed directory', () => {
		const result = validateFilePath(allowedFile, [allowedDir]);
		expect(result.error).toBeNull();
		if (result.error === null) expect(result.canonicalPath).toBe(allowedFile);
	});

	test('L6: accepts a nested file inside an allowed directory', () => {
		expect(validateFilePath(nestedFile, [allowedDir]).error).toBeNull();
	});

	test('L6: symlink escaping the allowed directory resolves to its real target and is rejected', () => {
		test.skip(!existsSync(symlinkToOutside), 'symlink creation not permitted in this environment');
		expect(validateFilePath(symlinkToOutside, [allowedDir]).error).toBe('Access denied');
	});

	test('L6: accepts a path under any one of several configured directories', () => {
		const result = validateFilePath(allowedFile, ['/some/other/unrelated/dir', allowedDir]);
		expect(result.error).toBeNull();
	});

	// --- Layer 4.5: lexical containment closes the host-wide existence oracle ---
	test('L4.5: out-of-tree paths are indistinguishable whether they exist or not', () => {
		// /etc exists on the test host; the random name under it does not. Both
		// must return the same 'Access denied' — no 404-vs-403 signal that would
		// let a caller probe for the existence of arbitrary host files.
		const existing = validateFilePath('/etc', [allowedDir]).error;
		const missing = validateFilePath('/etc/hollama-nonexistent-xyz-oracle', [allowedDir]).error;
		expect(existing).toBe('Access denied');
		expect(missing).toBe('Access denied');
		expect(existing).toBe(missing);
	});

	test('L4.5: an in-tree missing file still reports Path not accessible', () => {
		// Inside an allowed dir, a 404-class signal is fine (the caller is
		// authorized to enumerate that tree) — only *out-of-tree* existence must
		// be hidden.
		expect(validateFilePath(join(allowedDir, 'still-missing.txt'), [allowedDir]).error).toBe(
			'Path not accessible'
		);
	});

	// --- Layer 7: post-canonical sanity ---
	// realpathSync should never itself produce a path containing '/../' — this
	// layer is defense-in-depth against a hypothetical realpath bug, so it's
	// exercised indirectly: every accepted path above already proves normal
	// canonical paths pass Layer 7 without being rejected.
	test('L7: a normally-resolved canonical path is not rejected by the post-canonical check', () => {
		const result = validateFilePath(nestedFile, [allowedDir]);
		expect(result.error).toBeNull();
	});
});

test.describe('containsDotfileSegment', () => {
	const roots = ['/srv/data'];

	test('flags a dotfile directly under the root', () => {
		expect(containsDotfileSegment('/srv/data/.env', roots)).toBe(true);
	});

	test('flags a file nested inside a dot-directory', () => {
		expect(containsDotfileSegment('/srv/data/.git/config', roots)).toBe(true);
	});

	test('allows an ordinary nested file', () => {
		expect(containsDotfileSegment('/srv/data/sub/notes.txt', roots)).toBe(false);
	});

	test('allows the root itself even when the configured root is a dot-directory', () => {
		expect(containsDotfileSegment('/srv/.config', ['/srv/.config'])).toBe(false);
		expect(containsDotfileSegment('/srv/.config/app.txt', ['/srv/.config'])).toBe(false);
	});

	test('a leading dot only in a file extension does not count as a dotfile', () => {
		expect(containsDotfileSegment('/srv/data/archive.tar.gz', roots)).toBe(false);
	});
});
