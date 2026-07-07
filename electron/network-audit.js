const networkLog = [];

export function enableNetworkAudit(electronSession) {
	const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };

	electronSession.defaultSession.webRequest.onSendHeaders(filter, (details) => {
		const entry = {
			timestamp: new Date().toISOString(),
			url: details.url,
			method: details.method,
			resourceType: details.resourceType,
			referrer: details.referrer || null
		};

		if (
			details.url.startsWith('http://127.0.0.1') ||
			details.url.startsWith('http://localhost') ||
			details.url.startsWith('ws://127.0.0.1') ||
			details.url.startsWith('ws://localhost')
		) {
			entry.classification = 'LOCAL';
		} else {
			entry.classification = 'EXTERNAL';
			console.warn(`[NETWORK AUDIT] EXTERNAL REQUEST: ${details.method} ${details.url}`);
		}

		networkLog.push(entry);
	});

	electronSession.defaultSession.webRequest.onCompleted(filter, (details) => {
		const last = networkLog.findLast((e) => e.url === details.url);
		if (last) {
			last.statusCode = details.statusCode;
			last.fromCache = details.fromCache;
		}
	});

	electronSession.defaultSession.webRequest.onErrorOccurred(filter, (details) => {
		const last = networkLog.findLast((e) => e.url === details.url);
		if (last) {
			last.error = details.error;
		}
	});

	console.log('[NETWORK AUDIT] Enabled — monitoring all outbound requests');
}

export function getExternalRequests() {
	return networkLog.filter((e) => e.classification === 'EXTERNAL');
}

export function printNetworkSummary() {
	const local = networkLog.filter((e) => e.classification === 'LOCAL').length;
	const external = networkLog.filter((e) => e.classification === 'EXTERNAL').length;

	console.log('\n=== NETWORK AUDIT SUMMARY ===');
	console.log(`Local requests: ${local}`);
	console.log(`External requests: ${external}`);

	if (external > 0) {
		console.log('\nEXTERNAL REQUESTS DETECTED:');
		getExternalRequests().forEach((e) => {
			console.log(`  ${e.method} ${e.url} (${e.resourceType}) ${e.statusCode || e.error || ''}`);
		});
	} else {
		console.log('\nNo external requests detected.');
	}
	console.log('=============================\n');
}
