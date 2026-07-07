import { ConnectionType, type Server } from '$lib/connections';
import { networkLog } from '$lib/networkLog';
import type { Model } from '$lib/settings';

import type { ChatRequest, ChatStrategy, Message } from './index';

/** Maximum bytes we'll buffer while waiting for an SSE event terminator
 *  (\\n\\n). Without this cap, a malicious upstream can mount a low-effort
 *  DoS by streaming bytes that never include the terminator. 1 MB is a
 *  generous bound for legitimate OpenAI SSE responses. */
const MAX_SSE_BUFFER = 1_048_576;

export class OpenAIStrategy implements ChatStrategy {
	constructor(private server: Server) {}

	async chat(
		payload: ChatRequest,
		abortSignal: AbortSignal,
		onChunk: (content: string) => void,
		onReasoningChunk?: (content: string) => void
	): Promise<void> {
		const formattedMessages = payload.messages.map((message: Message) => {
			if (message.images && message.images.length > 0) {
				const content: Array<Record<string, unknown>> = [{ type: 'text', text: message.content }];
				message.images.forEach((img) => {
					let mimeType = 'image/jpeg';
					let base64Data = img;
					const dataUrlMatch = img.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/);
					if (dataUrlMatch) {
						mimeType = dataUrlMatch[1];
						base64Data = dataUrlMatch[2];
					}
					content.push({
						type: 'image_url',
						image_url: { url: `data:${mimeType};base64,${base64Data}` }
					});
				});
				return { role: 'user' as const, content };
			}
			const formatted: Record<string, unknown> = { role: message.role, content: message.content };
			if (message.role === 'assistant' && message.reasoning_content) {
				formatted.reasoning_content = message.reasoning_content;
			}
			return formatted;
		});

		const trimmedKey = this.server.sessionAffinityKey?.trim();
		const body: Record<string, unknown> = {
			baseUrl: this.server.baseUrl,
			model: payload.model,
			messages: formattedMessages,
			stream: true
		};
		if (trimmedKey && this.server.connectionType === ConnectionType.OpenAICompatible) {
			body.sessionAffinityKey = trimmedKey;
		}
		if (payload.reasoningEffort) {
			body.reasoningEffort = payload.reasoningEffort;
		}

		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: abortSignal
		});

		networkLog.log({
			url: '/api/chat',
			method: 'POST',
			status: response.status,
			source: 'Proxy Chat'
		});

		if (!response.ok) {
			let errorMsg: string;
			try {
				const err = await response.json();
				errorMsg = err.error || `Error ${response.status}`;
			} catch {
				errorMsg = `Error ${response.status}`;
			}
			throw new Error(errorMsg);
		}

		if (!response.body) throw new Error('Response is missing body');

		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let done = false;
		// Buffer for line fragments that span TCP chunk boundaries. SSE events
		// split across chunk reads would otherwise be silently dropped.
		let buffer = '';

		while (!done) {
			const result = await reader.read();
			if (result.done) {
				// Flush any trailing line that wasn't terminated with \n.
				if (buffer.trim()) {
					const data = buffer.startsWith('data: ') ? buffer.slice(6) : buffer;
					if (data.startsWith('[DONE]')) {
						done = true;
					} else if (data) {
						try {
							const parsed = JSON.parse(data);
							const delta = parsed.choices?.[0]?.delta;
							const content = delta?.content;
							if (content) onChunk(content);
							const reasoningContent = delta?.reasoning_content;
							if (reasoningContent && onReasoningChunk) onReasoningChunk(reasoningContent);
						} catch {
							// skip unparseable chunks
						}
					}
				}
				done = true;
				break;
			}
			if (!result.value) continue;

			buffer += result.value;
			// Cap the buffer to prevent DoS via unbounded growth when an
			// upstream never sends an SSE event terminator.
			if (buffer.length > MAX_SSE_BUFFER) {
				throw new Error('Upstream response exceeded 1 MB safety cap');
			}
			// Split on \n but keep the trailing fragment as the new buffer
			// (it may be a partial line that completes on the next read).
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				if (trimmed.startsWith('data: [DONE]')) {
					done = true;
					break;
				}
				const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
				if (!data) continue;
				try {
					const parsed = JSON.parse(data);
					const delta = parsed.choices?.[0]?.delta;
					const content = delta?.content;
					if (content) onChunk(content);
					const reasoningContent = delta?.reasoning_content;
					if (reasoningContent && onReasoningChunk) onReasoningChunk(reasoningContent);
				} catch {
					// skip unparseable chunks
				}
			}
		}
	}

	async getModels(): Promise<Model[]> {
		const modelsUrl = `/api/models?baseUrl=${encodeURIComponent(this.server.baseUrl)}`;
		const response = await fetch(modelsUrl);

		networkLog.log({
			url: modelsUrl,
			method: 'GET',
			status: response.status,
			source: 'Proxy Models'
		});

		if (!response.ok) {
			let errorMsg: string;
			try {
				const err = await response.json();
				errorMsg = err.error || `Error ${response.status}`;
			} catch {
				errorMsg = `Error ${response.status}`;
			}
			throw new Error(errorMsg);
		}

		const data = await response.json();
		// A 200 response is not proof of a model list. LM Studio (and some other
		// OpenAI-compatible servers) answer an unknown path — e.g. a Base URL
		// missing its `/v1` suffix — with HTTP 200 and an *error* body that has
		// no `data` array. Treating that as an empty list makes verifyServer()
		// report a false "green" while the picker stays empty. Surface it as a
		// real failure so the toast shows the upstream's message instead.
		if (!Array.isArray(data?.data)) {
			const upstreamError = typeof data?.error === 'string' ? data.error : null;
			throw new Error(upstreamError || 'Unexpected response from server — check the Base URL');
		}
		return data.data
			.filter((model: { id: string }) => model.id.startsWith(this.server.modelFilter || ''))
			.map((model: { id: string }) => ({
				serverId: this.server.id,
				name: model.id
			}));
	}

	private async probeChat(): Promise<true> {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				baseUrl: this.server.baseUrl,
				model: 'test',
				messages: [{ role: 'user', content: '.' }]
			})
		});

		if (response.status === 401) {
			throw new Error('Invalid API key');
		}
		if (response.status === 403) {
			throw new Error('Access denied — check API key permissions');
		}
		if (response.status === 502) {
			throw new Error('Cannot reach server — check the URL and network connection');
		}
		return true;
	}

	async verifyServer(): Promise<true> {
		try {
			await this.getModels();
			return true;
		} catch (e) {
			if (e instanceof TypeError) {
				throw new Error('Cannot reach server — check the URL and network connection');
			}
			const msg = e instanceof Error ? e.message : '';
			if (msg.includes('401') || msg.toLowerCase().includes('invalid api key'))
				throw new Error('Invalid API key');
			if (msg.includes('403') || msg.toLowerCase().includes('access denied'))
				throw new Error('Access denied — check API key permissions');
			if (this.server.baseUrl.includes('fireworks.ai')) return this.probeChat();
			if (msg.includes('502') || msg.toLowerCase().includes('network'))
				throw new Error('Cannot reach server — check the URL and network connection');
			throw new Error(msg || 'Connection failed to verify');
		}
	}
}
