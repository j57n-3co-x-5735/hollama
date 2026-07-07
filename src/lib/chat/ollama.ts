import type {
	ChatResponse,
	ErrorResponse,
	ListResponse,
	ProgressResponse,
	PullRequest,
	StatusResponse
} from 'ollama/browser';

import type { Server } from '$lib/connections';
import { networkLog } from '$lib/networkLog';
import type { Model } from '$lib/settings';

// Use the app's ChatRequest (carries reasoningEffort) rather than ollama's — we
// translate reasoning → Ollama's native `think` before sending.
import type { ChatRequest, ChatStrategy } from './index';

/** Maximum bytes we'll buffer while waiting for a newline-terminated line in
 *  a streaming NDJSON response. Without this cap, a malicious upstream can
 *  mount a low-effort DoS by streaming bytes that never include \\n. 1 MB is
 *  a generous bound for legitimate Ollama responses and well under any
 *  sensible process memory limit. */
const MAX_NDJSON_BUFFER = 1_048_576;

export interface OllamaOptions {
	numa: boolean;
	num_ctx: number;
	num_batch: number;
	num_gpu: number;
	main_gpu: number;
	low_vram: boolean;
	f16_kv: boolean;
	// logits_all: boolean; // REF https://github.com/ollama/ollama-js/issues/145
	vocab_only: boolean;
	use_mmap: boolean;
	use_mlock: boolean;
	// embedding_only: boolean; // REF https://github.com/ollama/ollama-js/issues/145
	num_thread: number;

	// Runtime options
	num_keep: number;
	seed: number;
	num_predict: number;
	top_k: number;
	top_p: number;
	min_p: number; // REF https://github.com/ollama/ollama-js/issues/145
	tfs_z: number;
	typical_p: number;
	repeat_last_n: number;
	temperature: number;
	repeat_penalty: number;
	presence_penalty: number;
	frequency_penalty: number;
	mirostat: number;
	mirostat_tau: number;
	mirostat_eta: number;
	penalize_newline: boolean;
	stop: string[];
}

/** Ollama's streamed chat message carries a `thinking` field (native
 *  chain-of-thought) when the request set `think: true`. The pinned ollama JS
 *  types don't declare it, so widen locally. */
type OllamaStreamMessage = ChatResponse['message'] & { thinking?: string };

export class OllamaStrategy implements ChatStrategy {
	constructor(private server: Server) {}

	async chat(
		payload: ChatRequest,
		abortSignal: AbortSignal,
		onChunk: (content: string) => void,
		onReasoningChunk?: (content: string) => void
	): Promise<void> {
		const chatUrl = `${this.server.baseUrl}/api/chat`;
		// Ollama has native "thinking": `think: true` asks a reasoning-capable
		// model to stream its chain-of-thought in a separate `message.thinking`
		// field. Map our generic reasoning toggle to it, and drop reasoningEffort
		// (an OpenAI-family param Ollama doesn't understand) from the body.
		const { reasoningEffort, ...ollamaPayload } = payload;
		const body: Record<string, unknown> = { ...ollamaPayload };
		if (reasoningEffort) body.think = true;
		const response = await fetch(chatUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: abortSignal
		});

		networkLog.log({
			url: chatUrl,
			method: 'POST',
			status: response.status,
			source: 'Ollama Chat'
		});

		if (!response.body) throw new Error('Ollama response is missing body');

		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let isCompletionDone = false;
		// Buffer for NDJSON line fragments that span TCP chunk boundaries.
		// Without this, a JSON object split across reads triggers a JSON.parse
		// crash and the trailing content is dropped.
		let buffer = '';

		while (!isCompletionDone) {
			const { value, done } = await reader.read();

			if (done) {
				// Flush any trailing line that wasn't terminated with \n.
				if (buffer.trim()) {
					if (!response.ok) {
						// Parse the buffered error body. If parse succeeds, surface
						// the upstream's error message; if it fails (incomplete or
						// non-JSON body), fall back to the raw buffer. Catching
						// SyntaxError specifically — a bare catch { } would swallow
						// our intentional `throw new Error(parsed.error ...)` on
						// the successful-parse path.
						let parsed: { error?: string };
						try {
							parsed = JSON.parse(buffer) as { error?: string };
						} catch (err) {
							if (err instanceof SyntaxError) {
								throw new Error(buffer);
							}
							throw err;
						}
						throw new Error(parsed.error ?? buffer);
					}
					// At stream end, a non-empty buffer that won't parse is a
					// truncated/malformed final object — not an as-yet-incomplete
					// mid-stream line the next read would complete. Let the parse
					// error propagate (→ handleCompletion's catch → error toast)
					// rather than silently dropping it, which would finish the
					// completion with an empty assistant message and no indication
					// anything went wrong. The mid-stream loop below still tolerates
					// partial lines by design — this stream-end/mid-stream asymmetry
					// is deliberate (at stream end there is no "next read").
					const parsed = JSON.parse(buffer) as ChatResponse;
					// A well-formed JSON frame that carries no `message` (abnormal,
					// but not a parse error) must not throw a TypeError on
					// `message.content`; skip it instead.
					const message = parsed.message as OllamaStreamMessage | undefined;
					if (message) {
						if (message.thinking && onReasoningChunk) onReasoningChunk(message.thinking);
						onChunk(message.content);
					}
				}
				isCompletionDone = true;
				break;
			}

			if (!value) continue;

			buffer += value;
			// Cap the buffer to prevent DoS via unbounded growth when an
			// upstream never sends a newline.
			if (buffer.length > MAX_NDJSON_BUFFER) {
				throw new Error('Upstream response exceeded 1 MB safety cap');
			}

			if (!response.ok) {
				// On error we don't try to parse line-by-line (the body may be a
				// single JSON object that doesn't terminate with a newline until
				// the stream ends). Keep buffering until done; the post-loop
				// flush above will parse the whole body.
				continue;
			}

			// Split on \n but keep the trailing fragment in the buffer for the
			// next read.
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const chatResponse of lines) {
				if (!chatResponse.trim()) continue;
				try {
					const parsed = JSON.parse(chatResponse) as ChatResponse;
					// Guard a message-less frame: `message.content` on undefined is a
					// TypeError, which (unlike a SyntaxError) is NOT swallowed below
					// and would abort an otherwise-healthy stream.
					const message = parsed.message as OllamaStreamMessage | undefined;
					if (message) {
						if (message.thinking && onReasoningChunk) onReasoningChunk(message.thinking);
						onChunk(message.content);
					}
				} catch (err) {
					if (!(err instanceof SyntaxError)) throw err;
					// skip unparseable lines
				}
			}
		}
	}

	async getModels(): Promise<Model[]> {
		const tagsUrl = `${this.server.baseUrl}/api/tags`;
		const response = await fetch(tagsUrl);
		networkLog.log({
			url: tagsUrl,
			method: 'GET',
			status: response.status,
			source: 'Ollama Models'
		});
		if (!response.ok) throw new Error('Failed to fetch Ollama tags');

		const data: ListResponse | undefined = await response.json();
		if (!data || !Array.isArray(data.models)) {
			throw new Error('Failed to parse Ollama tags', { cause: data });
		}

		return data.models
			?.filter((model) => model.name.startsWith(this.server.modelFilter || ''))
			.map((model) => ({
				...model,
				serverId: this.server.id,
				parameterSize: model.details.parameter_size,
				modifiedAt: new Date(model.modified_at)
			}));
	}

	async pull(
		payload: PullRequest,
		onChunk: (progress: ProgressResponse | StatusResponse | ErrorResponse) => void
	): Promise<void> {
		const response = await fetch(`${this.server.baseUrl}/api/pull`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!response.body) throw new Error('Ollama response is missing body');

		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let isPullComplete = false;
		// NDJSON line buffer for fragments that span TCP chunk boundaries.
		let buffer = '';

		while (!isPullComplete) {
			const { value, done } = await reader.read();

			if (done) {
				if (buffer.trim()) {
					if (!response.ok) {
						// Same SyntaxError filter as in chat() — a bare catch
						// would swallow the intentional throw on the parse-success
						// path and surface the raw buffer instead of the parsed
						// error message.
						let parsed: ErrorResponse;
						try {
							parsed = JSON.parse(buffer) as ErrorResponse;
						} catch (err) {
							if (err instanceof SyntaxError) {
								throw new Error(buffer);
							}
							throw err;
						}
						throw new Error(parsed.error ?? buffer);
					}
					try {
						const parsed = JSON.parse(buffer) as ProgressResponse | StatusResponse;
						onChunk(parsed);
					} catch (err) {
						if (!(err instanceof SyntaxError)) throw err;
						// skip unparseable trailing line
					}
				}
				isPullComplete = true;
				break;
			}

			if (!value) continue;

			buffer += value;
			// Cap the buffer to prevent DoS via unbounded growth.
			if (buffer.length > MAX_NDJSON_BUFFER) {
				throw new Error('Upstream response exceeded 1 MB safety cap');
			}

			if (!response.ok) {
				// Defer error parsing until the stream is fully consumed;
				// the body may be a single JSON object that doesn't terminate
				// with a newline until done. Keep buffering.
				continue;
			}

			const progressUpdates = buffer.split('\n');
			buffer = progressUpdates.pop() ?? '';

			for (const update of progressUpdates) {
				if (!update.trim()) continue;
				try {
					const parsed = JSON.parse(update) as ProgressResponse;
					onChunk(parsed);
				} catch (err) {
					if (!(err instanceof SyntaxError)) throw err;
					// skip unparseable lines
				}
			}
		}
	}

	async verifyServer(): Promise<true> {
		try {
			await this.getModels();
			return true;
		} catch (e) {
			if (e instanceof TypeError) {
				throw new Error('Cannot reach server — check the URL and network connection');
			}
			throw new Error(e instanceof Error ? e.message : 'Connection failed to verify');
		}
	}
}
