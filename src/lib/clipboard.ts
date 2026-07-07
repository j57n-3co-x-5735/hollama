import { toast } from 'svelte-sonner';
import { get } from 'svelte/store';

import LL from '$i18n/i18n-svelte';

/** Writes text to the clipboard. Uses the async Clipboard API on secure
 * contexts; falls back to a hidden <textarea> + execCommand('copy') on
 * insecure (HTTP) connections, warning the user that the copy wasn't private.
 * Extracted from ButtonCopy.svelte so the copy/export menu can reuse it. */
export function copyToClipboard(content: string): void {
	if (navigator.clipboard && window.isSecureContext) {
		navigator.clipboard.writeText(content);
		return;
	}

	// HACK: workaround to copy on HTTP connections where the Clipboard API is
	// unavailable. https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem
	const textArea = document.createElement('textarea');
	textArea.value = content;
	document.body.appendChild(textArea);
	textArea.select();
	try {
		document.execCommand('copy');
		toast.warning(get(LL).copiedNotPrivate());
	} catch (e) {
		console.error(e);
		toast.error(get(LL).notCopiedNotPrivate());
	}
	document.body.removeChild(textArea);
}

/** Triggers a client-side download of `content` as a file named `filename`. */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain'): void {
	const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}
