import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import {
	clearFilesDirOverride,
	getAllowedFileDirs,
	readFilesDirConfig,
	setFilesDirOverride
} from '../../src/lib/server/filesConfig';

// Pure Node — no page/webServer needed. Exercises the persisted files-dir
// override against an isolated HOLLAMA_DATA_DIR. filesConfig resolves the data
// dir per call (not at import), so setting the env here — no re-import — is
// honored. This is the logic behind Item 3's "changing HOLLAMA_FILES_DIR from
// the UI, applied live" and the containment-safe precedence.

test.describe('files-dir override (filesConfig)', () => {
	let dataDir: string;
	let realDir: string;

	test.beforeEach(() => {
		dataDir = realpathSync(mkdtempSync(join(tmpdir(), 'hollama-data-')));
		realDir = realpathSync(mkdtempSync(join(tmpdir(), 'hollama-src-')));
		process.env.HOLLAMA_DATA_DIR = dataDir;
	});

	test.afterEach(() => {
		clearFilesDirOverride();
		rmSync(dataDir, { recursive: true, force: true });
		rmSync(realDir, { recursive: true, force: true });
		delete process.env.HOLLAMA_DATA_DIR;
	});

	test('a valid dir is persisted (canonical) and preferred over the env fallback', () => {
		const result = setFilesDirOverride([realDir]);
		expect(result.ok).toBe(true);
		expect(result.dirs).toEqual([realDir]); // realpath-canonical
		expect(getAllowedFileDirs()).toEqual([realDir]);
		expect(readFilesDirConfig()).toMatchObject({ source: 'override', dirs: [realDir] });
	});

	test('a non-existent path is rejected and NOT stored', () => {
		const result = setFilesDirOverride([join(realDir, 'does-not-exist')]);
		expect(result.ok).toBe(false);
		expect(result.invalid.length).toBe(1);
		expect(readFilesDirConfig().source).not.toBe('override');
	});

	test('a file (not a directory) is rejected', () => {
		const filePath = join(realDir, 'note.txt');
		writeFileSync(filePath, 'hi');
		const result = setFilesDirOverride([filePath]);
		expect(result.ok).toBe(false);
		expect(result.invalid).toContain(filePath);
	});

	test('empty input clears the override (reverts to env)', () => {
		setFilesDirOverride([realDir]);
		expect(readFilesDirConfig().source).toBe('override');
		const cleared = setFilesDirOverride([]);
		expect(cleared.ok).toBe(true);
		expect(readFilesDirConfig().source).not.toBe('override');
	});

	test('an all-invalid submission does NOT wipe an existing valid override', () => {
		setFilesDirOverride([realDir]);
		const bad = setFilesDirOverride([join(realDir, 'nope')]);
		expect(bad.ok).toBe(false);
		// Prior override must remain intact — a typo shouldn't disable file access.
		expect(getAllowedFileDirs()).toEqual([realDir]);
	});
});
