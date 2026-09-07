import { json } from '@sveltejs/kit';
import { validateConfig } from '$core/validate.js';
import { getComputed, getDraft, PreviewError, rowId } from '$lib/server/preview';
import type { RequestHandler } from './$types';

const CAP = 300;

/** Asset ids for one planned album, so the modal can show it. Takes a draft config like the preview. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as
		| { id?: string; config?: unknown; scope?: string }
		| null;
	if (!body?.id) return json({ error: 'id is required' }, { status: 400 });
	try {
		const scope = body.scope === 'all' ? 'all' : 'window';
		let computed = await getComputed(scope);
		if (body.config !== undefined) {
			const { config, issues } = validateConfig(body.config);
			if (issues.length) return json({ error: `${issues.length} invalid field(s)`, issues }, { status: 400 });
			computed = await getDraft(config, scope);
		}
		const action = computed.actions.find((a) => rowId(a) === body.id);
		if (!action) return json({ error: `no album ${body.id} in this plan` }, { status: 404 });
		const points = action.plan.ids
			.map((id) => computed.gps.get(id))
			.filter((p): p is { lat: number; lon: number } => !!p)
			.slice(0, 500);
		return json({
			id: body.id,
			points,
			name: action.op === 'update' || action.op === 'rename' ? (action.userRenamed ? action.album.name : action.plan.name) : action.plan.name,
			ids: action.plan.ids.slice(0, CAP),
			total: action.plan.ids.length,
			add:
				action.op === 'create'
					? action.plan.ids.slice(0, CAP)
					: action.op === 'noop'
						? []
						: action.add.slice(0, CAP),
			remove: action.op === 'update' || action.op === 'rename' ? action.remove.slice(0, CAP) : []
		});
	} catch (e) {
		const status = e instanceof PreviewError ? e.status : 500;
		return json({ error: (e as Error).message }, { status });
	}
};
