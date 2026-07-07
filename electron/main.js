import net from 'net';
import { join } from 'path';
import { app, BrowserWindow, dialog, session, utilityProcess } from 'electron';

import { enableNetworkAudit, printNetworkSummary } from './network-audit.js';

// Vite default dev & production ports
const hollamaPort = app.isPackaged ? '4173' : '5173';
const HOLLAMA_HOST = '127.0.0.1';

function createWindow() {
	const mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 400,
		minHeight: 640,
		webPreferences: {}
	});

	mainWindow.menuBarVisible = false; // Windows: hides the menu bar
	mainWindow.loadURL(`http://${HOLLAMA_HOST}:${hollamaPort}`);
}

function checkServerAvailability(port) {
	const MAX_RETRIES = 10;
	const RETRY_INTERVAL_IN_MS = 1000;

	return new Promise((resolve, reject) => {
		let retries = 0;

		function tryConnection() {
			const socket = new net.Socket();

			const onError = () => {
				socket.destroy();

				if (retries >= MAX_RETRIES) {
					reject(new Error(`Couldn't connect to Hollama server after ${MAX_RETRIES} attempts`));
				} else {
					retries++;
					setTimeout(tryConnection, RETRY_INTERVAL_IN_MS);
				}
			};

			socket.setTimeout(1000);
			socket.once('error', onError);
			socket.once('timeout', onError);

			socket.connect(port, HOLLAMA_HOST, () => {
				socket.destroy();
				resolve();
			});
		}

		tryConnection();
	});
}

app
	.whenReady()
	.then(async () => {
		enableNetworkAudit(session);

		session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
			const url = new URL(details.url);
			if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
				callback({});
				return;
			}
			callback({
				responseHeaders: {
					...details.responseHeaders,
					'Access-Control-Allow-Origin': ['*'],
					'Access-Control-Allow-Headers': ['*'],
					'Access-Control-Allow-Methods': ['GET, POST, OPTIONS']
				}
			});
		});

		if (app.isPackaged) {
			// Whitelist of env vars forwarded to the embedded SvelteKit process.
			// Keeping the list narrow limits what the embedded server can read
			// from the operator's environment. The list covers common production
			// needs: app identity (PORT, PUBLIC_ADAPTER), shell utilities
			// (HOME, PATH), API key for the OpenAI/Compatible proxy
			// (OPENAI_API_KEY), CSP source list (PUBLIC_CSP_CONNECT_SOURCES),
			// runtime mode (NODE_ENV), corporate-proxy routing (HTTP_PROXY,
			// HTTPS_PROXY, NO_PROXY), TLS configuration (NODE_EXTRA_CA_CERTS,
			// NODE_TLS_REJECT_UNAUTHORIZED), and the files feature's allowed
			// directory list (HOLLAMA_FILES_DIR) plus its optional extension
			// allowlist (HOLLAMA_FILES_ALLOWED_EXTENSIONS). To forward additional
			// vars, edit this list.
			const childEnv = {
					PORT: hollamaPort,
					PUBLIC_ADAPTER: 'electron-node',
					HOME: process.env.HOME || '',
					PATH: process.env.PATH || '',
					HOLLAMA_DATA_DIR: join(app.getPath('userData'), 'data'),
					HOST: '127.0.0.1',
					ORIGIN: 'http://127.0.0.1:' + hollamaPort
				};
			if (process.env.OPENAI_API_KEY) childEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
			if (process.env.PUBLIC_CSP_CONNECT_SOURCES) childEnv.PUBLIC_CSP_CONNECT_SOURCES = process.env.PUBLIC_CSP_CONNECT_SOURCES;
			if (process.env.NODE_ENV) childEnv.NODE_ENV = process.env.NODE_ENV;
			// Corporate proxy routing — common for enterprise deployments.
			if (process.env.HTTP_PROXY) childEnv.HTTP_PROXY = process.env.HTTP_PROXY;
			if (process.env.HTTPS_PROXY) childEnv.HTTPS_PROXY = process.env.HTTPS_PROXY;
			if (process.env.NO_PROXY) childEnv.NO_PROXY = process.env.NO_PROXY;
			// TLS configuration — needed for corporate CA bundles and
			// self-signed certificate environments.
			if (process.env.NODE_EXTRA_CA_CERTS) childEnv.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS;
			if (process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
				childEnv.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
			}
			if (process.env.HOLLAMA_FILES_DIR) childEnv.HOLLAMA_FILES_DIR = process.env.HOLLAMA_FILES_DIR;
			if (process.env.HOLLAMA_FILES_ALLOWED_EXTENSIONS) childEnv.HOLLAMA_FILES_ALLOWED_EXTENSIONS = process.env.HOLLAMA_FILES_ALLOWED_EXTENSIONS;
			utilityProcess.fork(join(app.getAppPath(), 'build', 'index.js'), { env: childEnv });
		} else {
			console.warn('##### Running Electron in development mode');
			console.log('##### Run `npm run dev` to start the Hollama server separately');
		}

		await checkServerAvailability(parseInt(hollamaPort));
		createWindow();
	})
	.catch((error) => {
		dialog.showErrorBox('Error', error.message);
		app.quit();
	});

app.on('before-quit', () => {
	printNetworkSummary();
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function () {
	if (process.platform !== 'darwin') app.quit();
});

// macOS: Open a window if none are open
app.on('activate', function () {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
