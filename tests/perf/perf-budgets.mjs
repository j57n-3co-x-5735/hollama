// Performance-budget verification for the app's dominant computations.
//
// Why this is a node microbenchmark and not a Playwright assertion: the budgets
// are about the dominant *computation* (e.g. "<5ms to filter 500 sessions"),
// and a Playwright wall-clock is swamped by browser round-trip / event-dispatch
// overhead — it cannot resolve a 5ms in-page operation. The E2E stress test
// (storage-stress.test.ts) still covers correctness at scale; this file
// verifies the budgets, records real numbers, and is cheap + repeatable (no
// build, no browser).
//
// Faithfulness:
//   • The two server budgets exercise the REAL node fs calls the routes use
//     (src/routes/api/files[/content]/+server.ts): readdirSync+statSync for the
//     listing, openSync/fstatSync/readFileSync + 1024-byte binary sniff for the
//     read. Faithful by construction.
//   • The in-page budgets replicate the exact array operations from the source
//     (folders.ts getFoldersWithSessions; SidebarSessionList search filter and
//     batch-delete filter; localStorage.ts JSON.stringify subscriber) against a
//     realistic 500-session payload. They measure the representative dominant
//     work, not the Svelte reactive layer.
//
// Run: node tests/perf/perf-budgets.mjs   (exit 0 always; prints PASS/FAIL per
// budget so an exceeded budget is a recorded, greppable result rather than a
// hard crash).

import {
	closeSync,
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

/** Median wall-clock (ms) of `fn` over `runs` iterations after `warmup` warm-up
 * iterations — median rather than min/mean to resist GC/scheduler jitter. */
function median(fn, { runs = 25, warmup = 5 } = {}) {
	for (let i = 0; i < warmup; i++) fn();
	const samples = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		fn();
		samples.push(performance.now() - t0);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)];
}

// --- Synthetic data: 500 sessions ~ a few KB each, 50 of them in a folder. ---
// Sized so the 500 sessions serialize to ~2.69MB — a realistic worst-case scale
// for the local store, and the point at which serialization cost starts to matter.
const FILLER = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(45);
const sessions = Array.from({ length: 500 }, (_, i) => ({
	id: `sess-${i.toString().padStart(4, '0')}`,
	title: '',
	messages: [
		{ role: 'user', content: `Question ${i} about a topic. ${FILLER}` },
		{ role: 'assistant', content: `Answer ${i}. ${FILLER}` }
	],
	systemPrompt: { role: 'system', content: '' },
	systemPromptText: '',
	options: {},
	model: { name: 'gemma:7b', serverId: 'srv' },
	updatedAt: new Date(Date.now() - i * 1000).toISOString(),
	folderId: i < 50 ? 'folder-a' : undefined
}));
const folders = [{ id: 'folder-a', name: 'Folder A', isExpanded: true, sortOrder: 0, updatedAt: '' }];

// Mirrors sessions.ts getSessionTitle(): stored title, else first user message.
function sessionTitle(s) {
	if (s.title) return s.title;
	const firstUser = s.messages.find((m) => m.role === 'user');
	return (firstUser?.content ?? '').slice(0, 56);
}

// Mirrors folders.ts:72-90 getFoldersWithSessions().
function groupFoldersWithSessions(sess, fold) {
	const folderIds = new Set(fold.map((f) => f.id));
	const unfiled = sess.filter((s) => !s.folderId || !folderIds.has(s.folderId));
	const sorted = [...fold].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
	return { unfiled, folders: sorted.map((f) => ({ folder: f, sessions: sess.filter((s) => s.folderId === f.id) })) };
}

// Mirrors SidebarSessionList search: title/model/id, case-insensitive includes.
function searchFilter(sess, query) {
	const q = query.trim().toLowerCase();
	return sess.filter(
		(s) =>
			sessionTitle(s).toLowerCase().includes(q) ||
			(s.model?.name ?? '').toLowerCase().includes(q) ||
			s.id.toLowerCase().includes(q)
	);
}

const results = [];
function record(label, budgetMs, measuredMs, note = '') {
	const pass = measuredMs <= budgetMs;
	results.push({ label, budgetMs, measuredMs, pass, note });
}

// 1. Group derivation (render prep). DOM paint is separate & browser-measured.
record(
	'getFoldersWithSessions (500 sessions)',
	100,
	median(() => groupFoldersWithSessions(sessions, folders)),
	'render-prep computation only; DOM paint measured in-browser'
);

// 2. Search filter over 500 sessions.
record(
	'search filter (500 sessions)',
	5,
	median(() => searchFilter(sessions, 'Question 250'))
);

// 3. Batch-delete filter (remove 100 by Set membership) — single store mutation.
const deleteIds = new Set(sessions.slice(0, 100).map((s) => s.id));
record(
	'batch-delete filter (100 of 500)',
	150,
	median(() => sessions.filter((s) => !deleteIds.has(s.id)))
);

// 4. Serialization cost per store write (debounce trigger: >100ms => debounce).
const serializedBytes = Buffer.byteLength(JSON.stringify(sessions), 'utf8');
record(
	'JSON.stringify serialize (500 sessions)',
	100,
	median(() => JSON.stringify(sessions)),
	`payload ~${(serializedBytes / (1024 * 1024)).toFixed(2)}MB — debounce warranted only if >100ms`
);

// --- Server fs budgets: the real node calls the routes make. ---
const tmp = mkdtempSync(join(tmpdir(), 'hollama-perf-'));
try {
	// 5. Directory listing: 1000 entries, readdirSync(withFileTypes) + statSync each.
	const listDir = join(tmp, 'listing');
	mkdirSync(listDir);
	for (let i = 0; i < 1000; i++) writeFileSync(join(listDir, `file-${i}.txt`), 'x');
	record(
		'directory listing (1000 entries)',
		50,
		median(
			() => {
				const dirents = readdirSync(listDir, { withFileTypes: true });
				for (const d of dirents.slice(0, 1000)) {
					if (!d.name.startsWith('.')) statSync(join(listDir, d.name));
				}
			},
			{ runs: 15, warmup: 3 }
		)
	);

	// 6. 10MB file read: openSync -> fstatSync -> readFileSync -> 1024-byte sniff.
	const bigFile = join(tmp, 'big.txt');
	writeFileSync(bigFile, Buffer.alloc(10 * 1024 * 1024, 0x61)); // 10MB of 'a'
	record(
		'10MB file read (fd + binary sniff)',
		1000,
		median(
			() => {
				const fd = openSync(bigFile, 'r');
				try {
					const stat = fstatSync(fd);
					if (stat.size > 10 * 1024 * 1024) throw new Error('too large');
					const buf = readFileSync(fd);
					const sample = buf.subarray(0, Math.min(1024, buf.length));
					sample.includes(0);
					new TextDecoder('utf-8', { fatal: true }).decode(sample);
				} finally {
					closeSync(fd);
				}
			},
			{ runs: 10, warmup: 2 }
		)
	);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

// --- Report ---
let anyFail = false;
console.log('\nPerformance budget verification (median of N runs):\n');
console.log('  status  budget     measured   operation');
console.log('  ------  ---------  ---------  ' + '-'.repeat(40));
for (const r of results) {
	if (!r.pass) anyFail = true;
	const status = r.pass ? 'PASS  ' : 'FAIL* ';
	const budget = `${r.budgetMs}ms`.padStart(8);
	const measured = `${r.measuredMs.toFixed(3)}ms`.padStart(9);
	console.log(`  ${status}  ${budget}   ${measured}  ${r.label}`);
	if (r.note) console.log(`                                 ↳ ${r.note}`);
}
console.log('');
if (anyFail) {
	console.log('FAIL* = budget exceeded — record it as a performance regression to investigate.');
} else {
	console.log('All budgets met. Serialization < 100ms → localStorage debounce NOT warranted.');
}
