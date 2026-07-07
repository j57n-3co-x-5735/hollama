export const SEARCH_HIGHLIGHT_CLASS = 'search-highlight';
export const SEARCH_HIGHLIGHT_ACTIVE_CLASS = 'search-highlight--active';

/** Removes all <mark class="search-highlight"> elements added by
 * highlightMatches(), restoring plain text and merging adjacent text nodes
 * back together via normalize(). Safe to call when nothing is highlighted. */
export function clearHighlights(root: HTMLElement): void {
	const marks = root.querySelectorAll(`mark.${SEARCH_HIGHLIGHT_CLASS}`);
	marks.forEach((mark) => {
		const parent = mark.parentNode;
		if (!parent) return;
		parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
	});
	root.normalize();
}

function isSearchableTextNode(node: Node): boolean {
	const parent = (node as Text).parentElement;
	// Skip code blocks (search hits inside code would light up half a
	// snippet and confuse more than help) and KaTeX-rendered math (not
	// natural-language content).
	return !!parent && !parent.closest('pre, code, .katex');
}

/** Walks text nodes within a single `.markdown` container and wraps
 * case-insensitive matches of `query` in <mark> elements, appending them to
 * `marks` in document order. A match spanning multiple text nodes (e.g. a
 * search term crossing a **bold** boundary) produces one <mark> per node it
 * touches, since a single element can't span a DOM tree fork. */
function highlightInContainer(container: HTMLElement, query: string, marks: HTMLElement[]): void {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			isSearchableTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
	});

	const textNodes: Text[] = [];
	let current: Node | null;
	while ((current = walker.nextNode())) textNodes.push(current as Text);
	if (textNodes.length === 0) return;

	const nodeTexts = textNodes.map((node) => node.textContent ?? '');
	const fullText = nodeTexts.join('');
	const lowerFullText = fullText.toLowerCase();
	const lowerQuery = query.toLowerCase();

	const matchRanges: [start: number, end: number][] = [];
	let searchFrom = 0;
	while (searchFrom <= lowerFullText.length) {
		const index = lowerFullText.indexOf(lowerQuery, searchFrom);
		if (index === -1) break;
		matchRanges.push([index, index + lowerQuery.length]);
		searchFrom = index + lowerQuery.length;
	}
	if (matchRanges.length === 0) return;

	// Replace each original text node with [text?, mark, text?, mark, ...]
	// fragments in place. Node offsets are computed up front from the
	// unmodified DOM, so replacing one node doesn't invalidate the others.
	let cursor = 0;
	textNodes.forEach((node, i) => {
		const text = nodeTexts[i];
		const nodeStart = cursor;
		const nodeEnd = cursor + text.length;
		cursor = nodeEnd;

		const overlapping = matchRanges.filter(([start, end]) => start < nodeEnd && end > nodeStart);
		if (overlapping.length === 0) return;

		const fragments: Node[] = [];
		let localPos = 0;
		for (const [start, end] of overlapping) {
			const localStart = Math.max(0, start - nodeStart);
			const localEnd = Math.min(text.length, end - nodeStart);
			if (localStart > localPos) {
				fragments.push(document.createTextNode(text.slice(localPos, localStart)));
			}
			const mark = document.createElement('mark');
			mark.className = SEARCH_HIGHLIGHT_CLASS;
			mark.textContent = text.slice(localStart, localEnd);
			fragments.push(mark);
			marks.push(mark);
			localPos = localEnd;
		}
		if (localPos < text.length) fragments.push(document.createTextNode(text.slice(localPos)));

		node.replaceWith(...fragments);
	});
}

/** Rebuilds search highlights within `root`, scoped to each `.markdown`
 * container found inside it (one per rendered message). Returns the <mark>
 * elements in document order, which doubles as the navigable match list.
 * Always clears prior highlights first, so this is safe to call on every
 * query keystroke. */
export function highlightMatches(root: HTMLElement, query: string): HTMLElement[] {
	clearHighlights(root);
	if (!query.trim()) return [];

	const marks: HTMLElement[] = [];
	root.querySelectorAll<HTMLElement>('.markdown').forEach((container) => {
		// System messages aren't user-authored conversation content — skip them.
		if (container.closest('[data-message-role="system"]')) return;
		highlightInContainer(container, query, marks);
	});
	return marks;
}
