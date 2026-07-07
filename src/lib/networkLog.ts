import { writable } from 'svelte/store';

export interface NetworkLogEntry {
	timestamp: number;
	url: string;
	method: string;
	status: number;
	source: string;
}

const MAX_ENTRIES = 100;

function createNetworkLog() {
	const { subscribe, update } = writable<NetworkLogEntry[]>([]);

	return {
		subscribe,
		log(entry: Omit<NetworkLogEntry, 'timestamp'>) {
			const redactedUrl = entry.url.replace(
				/([?&])(api_key|apiKey|key|token|secret)=[^&]*/gi,
				'$1$2=[REDACTED]'
			);
			update((entries) => {
				const newEntry = { ...entry, url: redactedUrl, timestamp: Date.now() };
				const updated = [newEntry, ...entries];
				if (updated.length > MAX_ENTRIES) updated.length = MAX_ENTRIES;
				return updated;
			});
		}
	};
}

export const networkLog = createNetworkLog();
