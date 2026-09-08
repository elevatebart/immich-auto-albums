import { error } from '@sveltejs/kit';
import { authHeader } from '$core/immich.js';
import { credential, immichUrl } from '$lib/server/credentials';
import { readConfig } from '$lib/server/preview';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZES = new Set(['thumbnail', 'preview']);

/** Proxies an asset thumbnail so the key stays server side. Needs asset.view. */
export const GET: RequestHandler = async ({ params, url, fetch }) => {
	if (!UUID.test(params.id)) error(404, 'not an asset id');
	const cred = credential();
	if (!cred) error(404, 'no Immich behind this instance');
	const size = url.searchParams.get('size') ?? 'thumbnail';
	if (!SIZES.has(size)) error(400, 'size must be thumbnail or preview');
	const cfg = await readConfig();
	const base = immichUrl(cfg);
	const res = await fetch(`${base}/api/assets/${params.id}/thumbnail?size=${size}`, {
		headers: authHeader(cred)
	});
	// 403 means the key has no asset.view, which the UI turns into a hint.
	if (!res.ok) error(res.status === 403 ? 403 : res.status === 404 ? 404 : 502, `thumbnail: HTTP ${res.status}`);
	return new Response(res.body, {
		headers: {
			'content-type': res.headers.get('content-type') ?? 'image/jpeg',
			'cache-control': 'private, max-age=3600'
		}
	});
};
