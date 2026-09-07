import { json } from '@sveltejs/kit';
import { getPreview, PreviewError } from '$lib/server/preview';
import type { RequestHandler } from './$types';

/** Read-only: reconcile output for the current library. `?refresh=1` bypasses the cache. */
export const GET: RequestHandler = async ({ url }) => {
	try {
		return json(await getPreview(url.searchParams.get('refresh') === '1'));
	} catch (e) {
		const status = e instanceof PreviewError ? e.status : 500;
		return json({ error: (e as Error).message }, { status });
	}
};
