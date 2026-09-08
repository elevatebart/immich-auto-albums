import { error } from '@sveltejs/kit';
import { authHeader } from '$core/immich.js';
import { credential, immichUrl } from '$lib/server/credentials';
import { readConfig } from '$lib/server/preview';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Proxies a person thumbnail so the key stays server side. Needs person.read. */
export const GET: RequestHandler = async ({ params, fetch }) => {
	if (!UUID.test(params.id)) error(404, 'not a person id');
	const cred = credential();
	if (!cred) error(404, 'no Immich behind this instance');
	const cfg = await readConfig();
	const base = immichUrl(cfg);
	const res = await fetch(`${base}/api/people/${params.id}/thumbnail`, {
		headers: authHeader(cred)
	});
	if (!res.ok) error(res.status === 404 ? 404 : 502, `thumbnail: HTTP ${res.status}`);
	return new Response(res.body, {
		headers: {
			'content-type': res.headers.get('content-type') ?? 'image/jpeg',
			'cache-control': 'private, max-age=3600'
		}
	});
};
