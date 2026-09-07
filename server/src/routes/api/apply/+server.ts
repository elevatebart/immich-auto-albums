import { json } from '@sveltejs/kit';
import { applyActions } from '$lib/server/apply';
import { getComputed, PreviewError } from '$lib/server/preview';
import type { ApplyRequest } from '$lib/types';
import type { RequestHandler } from './$types';

/** Writes to Immich. Needs `confirm: true` and the token of the preview the caller acted on. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as ApplyRequest | null;
	if (body?.confirm !== true) {
		return json({ error: 'confirm must be true' }, { status: 400 });
	}
	if (typeof body.token !== 'string' || !body.token) {
		return json({ error: 'token is required; get it from GET /api/preview' }, { status: 400 });
	}
	try {
		const computed = await getComputed();
		if (body.token !== computed.data.token) {
			return json(
				{ error: 'The plan changed since that preview. Rescan, check the table, then confirm again.' },
				{ status: 409 }
			);
		}
		return json(await applyActions(computed, body.ids));
	} catch (e) {
		const status = e instanceof PreviewError ? e.status : 500;
		return json({ error: (e as Error).message }, { status });
	}
};
