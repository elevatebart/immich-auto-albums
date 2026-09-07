import { json } from '@sveltejs/kit';
import { validateConfig } from '$core/validate.js';
import { applyActions } from '$lib/server/apply';
import { getComputed, getDraft, PreviewError } from '$lib/server/preview';
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
	const scope = body.scope === 'all' ? 'all' : 'window';
	try {
		let computed;
		if (body.config === undefined) {
			computed = await getComputed(scope);
		} else {
			// An unsaved config can be applied; the token still has to match a replan of that same config.
			const { config, issues } = validateConfig(body.config);
			if (issues.length) {
				return json({ error: `${issues.length} invalid field(s)`, issues }, { status: 400 });
			}
			computed = await getDraft(config, scope);
		}
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
