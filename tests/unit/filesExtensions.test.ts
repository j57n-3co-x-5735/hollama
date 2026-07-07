import { expect, test } from '@playwright/test';

import { isExtensionAllowed, parseExtensionsEnv } from '../../src/lib/server/filesConfig';

// Pure-function unit tests for the optional HOLLAMA_FILES_ALLOWED_EXTENSIONS
// allowlist (plan N4). Like validateFilePath.test.ts, these need no browser or
// webServer — they exercise the decision logic directly. E2E coverage is kept
// at this unit level deliberately: the allowlist is read from the environment
// once at server startup, so an E2E test would have to set one global value for
// the entire file-server suite and would collide with the binary/size-limit
// fixtures that assume no restriction.
test.describe('parseExtensionsEnv', () => {
	test('returns an empty list when unset (no restriction)', () => {
		expect(parseExtensionsEnv(undefined)).toEqual([]);
		expect(parseExtensionsEnv('')).toEqual([]);
	});

	test('normalizes to leading-dot, lowercase form', () => {
		expect(parseExtensionsEnv('.TXT,md,.Json')).toEqual(['.txt', '.md', '.json']);
	});

	test('trims surrounding whitespace and drops empty entries', () => {
		expect(parseExtensionsEnv(' .txt ,  , .md , ')).toEqual(['.txt', '.md']);
	});
});

test.describe('isExtensionAllowed', () => {
	test('allows anything when the allowlist is empty (feature off)', () => {
		expect(isExtensionAllowed('/files/report.pdf', [])).toBe(true);
		expect(isExtensionAllowed('/files/no-extension', [])).toBe(true);
	});

	test('allows a file whose extension is on the list', () => {
		expect(isExtensionAllowed('/files/notes.txt', ['.txt', '.md'])).toBe(true);
	});

	test('rejects a file whose extension is not on the list', () => {
		expect(isExtensionAllowed('/files/report.pdf', ['.txt', '.md'])).toBe(false);
	});

	test('is case-insensitive on the file extension', () => {
		expect(isExtensionAllowed('/files/NOTES.TXT', ['.txt'])).toBe(true);
	});

	test('rejects extensionless files under an active allowlist', () => {
		expect(isExtensionAllowed('/files/Makefile', ['.txt'])).toBe(false);
	});

	test('matches only the final extension, not a middle segment', () => {
		// A misleadingly-named file must be judged by its true final extension.
		expect(isExtensionAllowed('/files/report.pdf.exe', ['.pdf'])).toBe(false);
		expect(isExtensionAllowed('/files/archive.tar.gz', ['.gz'])).toBe(true);
	});
});
