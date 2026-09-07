import { json } from '@sveltejs/kit';
import { validateConfig } from '$core/validate.js';
import { getDraft, getPreview, PreviewError } from '$lib/server/preview';
import type { RequestHandler } from './$types';

const fail = (e: unknown) =>
	json({ error: (e as Error).message }, { status: e instanceof PreviewError ? e.status : 500 });

/** Read-only: reconcile output for the config on disk. `?refresh=1` rescans the library. */
export const GET: RequestHandler = async ({ url }) => {
	try {
		return json(await getPreview(url.searchParams.get('refresh') === '1'));
	} catch (e) {
		return fail(e);
	}
};

/** Same output for an unsaved config, over the cached library. Writes nothing, ever. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { config?: unknown } | null;
	const { config, issues } = validateConfig(body?.config);
	if (issues.length) return json({ error: `${issues.length} invalid field(s)`, issues }, { status: 400 });
	try {
		return json((await getDraft(config)).data);
	} catch (e) {
		return fail(e);
	}
};
