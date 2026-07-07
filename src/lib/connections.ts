import { generateRandomId } from './utils';

const VALID_HEADER_NAME = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

const RESERVED_HEADERS = new Set([
	'authorization',
	'content-type',
	'host',
	'connection',
	'content-length',
	'transfer-encoding',
	'accept'
]);

export function sanitizeHeaders(raw: Record<string, string> | undefined): Record<string, string> {
	if (!raw) return {};
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw)) {
		const trimmed = key.trim();
		if (!trimmed || !value) continue;
		if (!VALID_HEADER_NAME.test(trimmed)) continue;
		const trimmedLower = trimmed.toLowerCase();
		if (RESERVED_HEADERS.has(trimmedLower)) continue;
		// Strip control chars (CR/LF/NUL response-splitting vectors) and trim
		// surrounding whitespace — HTTP field values have optional leading/
		// trailing whitespace stripped, and a whitespace-only value carries no
		// information, so drop it entirely rather than forward an empty header.
		// The control chars in this class are matched deliberately (that is the
		// point of the sanitizer), so the no-control-regex lint is a false positive.
		// eslint-disable-next-line no-control-regex
		const safeValue = value.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '').trim();
		if (!safeValue) continue;
		result[trimmedLower] = safeValue;
	}
	return result;
}

export enum ConnectionType {
	Ollama = 'ollama',
	OpenAI = 'openai',
	OpenAICompatible = 'openai-compatible',
	// LM Studio speaks the OpenAI-compatible protocol (/v1/models,
	// /v1/chat/completions) but is a keyless local server — presented as its
	// own first-class entry (like Ollama) and wired to OpenAIStrategy.
	LMStudio = 'lmstudio'
}

const VALID_CONNECTION_TYPES = new Set<string>(Object.values(ConnectionType));

export interface Server {
	id: string;
	baseUrl: string;
	connectionType: ConnectionType;
	isVerified: Date | null;
	isEnabled: boolean;
	label?: string;
	modelFilter?: string;
	sessionAffinityKey?: string;
}

/** Sanitize an untrusted Server object (e.g. from an imported JSON file).
 *  Throws on fields that cannot be made safe — caller should drop the
 *  offending record and surface an error to the user. */
export function sanitizeImportedServer(raw: unknown): Server {
	if (!raw || typeof raw !== 'object') throw new Error('Not a server object');
	const item = raw as Record<string, unknown>;

	// connectionType must be one of the enum values
	const ct = item.connectionType;
	if (typeof ct !== 'string' || !VALID_CONNECTION_TYPES.has(ct)) {
		throw new Error('Invalid connectionType');
	}

	// id is required for reactively keyed list updates; refuse empty / non-string
	const id = item.id;
	if (typeof id !== 'string' || !id.trim()) {
		throw new Error('Missing or invalid id');
	}

	// baseUrl must be a string; we use URL parser to reject malformed values
	const baseUrl = item.baseUrl;
	if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
		throw new Error('Missing or invalid baseUrl');
	}

	// Strip any credential from the baseUrl (defense against crafted exports
	// that try to embed userinfo into the URL).
	let safeBaseUrl = baseUrl.trim();
	try {
		const u = new URL(safeBaseUrl);
		if (u.username || u.password) {
			u.username = '';
			u.password = '';
			safeBaseUrl = u.toString();
		}
	} catch {
		throw new Error('Malformed baseUrl');
	}

	// sessionAffinityKey only allowed for OpenAI-compatible
	let sessionAffinityKey: string | undefined = undefined;
	if (ct === ConnectionType.OpenAICompatible && typeof item.sessionAffinityKey === 'string') {
		sessionAffinityKey = item.sessionAffinityKey;
	}

	// explicit coerce + reset: isVerified forced to null on import, isEnabled
	// forced to false so the user must re-verify. Crafted imports can otherwise
	// pre-verify a connection to a malicious URL.
	return {
		id,
		connectionType: ct as ConnectionType,
		baseUrl: safeBaseUrl,
		isVerified: null,
		isEnabled: false,
		label: typeof item.label === 'string' ? item.label : undefined,
		modelFilter: typeof item.modelFilter === 'string' ? item.modelFilter : undefined,
		sessionAffinityKey
	};
}

export function getDefaultServer(connectionType: ConnectionType): Server {
	let baseUrl: string = '';
	let modelFilter: string | undefined = undefined;

	switch (connectionType) {
		case ConnectionType.Ollama:
			baseUrl = 'http://localhost:11434';
			break;
		case ConnectionType.OpenAI:
			baseUrl = 'https://api.openai.com/v1';
			modelFilter = 'gpt';
			break;
		case ConnectionType.OpenAICompatible:
			baseUrl = 'http://localhost:8080/v1';
			break;
		case ConnectionType.LMStudio:
			// LM Studio's local server default. The `/v1` suffix is required —
			// the OpenAI-compatible models/chat routes live under it, and a
			// missing `/v1` silently yields an empty model list (LM Studio
			// answers unknown paths with HTTP 200 + an error body).
			baseUrl = 'http://localhost:1234/v1';
			break;
	}

	return {
		id: generateRandomId(),
		baseUrl,
		connectionType,
		modelFilter,
		isVerified: null,
		isEnabled: false
	};
}
