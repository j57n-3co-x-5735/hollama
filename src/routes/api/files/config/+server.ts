import { json } from '@sveltejs/kit';

import { env } from '$env/dynamic/public';
import { readFilesDirConfig, setFilesDirOverride } from '$lib/server/filesConfig';

// Desktop-only, hard 403 on web/docker. This is NOT the /api/files origin-skip
// pattern (`if (!isDesktop) checkOrigin()`) — that would accept any same-origin
// web caller and let a hosted deployment repoint the server's file roots to `/`
// or `/etc`. Configuring the filesystem source is only meaningful on the desktop
// app, where the user IS the operator on their own machine, so we block the
// route outright everywhere else, before any body parse. GET is gated too: it
// returns absolute paths (needed to prefill the settings box), which the codebase
// deliberately never discloses to untrusted origins (see filesConfig.ts:29-36).
function desktopGate(): Response | null {
	if (env.PUBLIC_ADAPTER !== 'electron-node') {
		return json(
			{ error: 'Source-directory configuration is only available in the desktop app' },
			{ status: 403 }
		);
	}
	return null;
}

export async function GET() {
	const blocked = desktopGate();
	if (blocked) return blocked;

	const config = readFilesDirConfig();
	return json(
		{ dirs: config.dirs, source: config.source },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
}

export async function POST({ request }) {
	const blocked = desktopGate();
	if (blocked) return blocked;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const dirs = (body as { dirs?: unknown })?.dirs;
	if (!Array.isArray(dirs) || !dirs.every((d) => typeof d === 'string')) {
		return json({ error: 'dirs must be an array of strings' }, { status: 400 });
	}

	const result = setFilesDirOverride(dirs as string[]);
	if (!result.ok) {
		return json(
			{
				error:
					result.invalid.length > 0
						? `Not a readable directory: ${result.invalid.join(', ')}`
						: 'Failed to save the source directory',
				invalid: result.invalid
			},
			{ status: 400 }
		);
	}

	return json({
		ok: true,
		dirs: result.dirs,
		source: result.dirs.length > 0 ? 'override' : 'env'
	});
}
