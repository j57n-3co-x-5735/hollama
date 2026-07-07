import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { version } from '$app/environment';

export interface HollamaMetadata {
	currentVersion: string;
	isDocker: boolean;
	isDesktop: boolean;
	hasServerApiKey: boolean;
}

/** @type {import('./$types').RequestHandler} */
export async function GET() {
	return json({
		currentVersion: version,
		isDesktop: env.PUBLIC_ADAPTER === 'electron-node',
		isDocker: env.PUBLIC_ADAPTER === 'docker-node',
		hasServerApiKey: !!privateEnv.OPENAI_API_KEY
	} as HollamaMetadata);
}
