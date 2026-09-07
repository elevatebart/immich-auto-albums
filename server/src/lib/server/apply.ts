import type { ImmichClient } from '$core/immich.js';
import { descriptionFor } from '$core/reconcile.js';
import type { Action } from '$core/types.js';
import type { ApplyResponse, ApplyResult } from '$lib/types';
import { immichClient, invalidate, PreviewError, rowId, type Computed } from './preview';
import { endJob, setJob, startJob } from './progress';

type Write = Exclude<Action, { op: 'noop' }>;

/** The only code path that mutates Immich. Same order as the CLI: album first, then assets. */
async function write(client: ImmichClient, marker: string, a: Write) {
	const desc = descriptionFor(marker, a.plan);
	if (a.op === 'create') {
		await client.createAlbum(a.plan.name, desc, [...a.plan.ids].sort());
		return;
	}
	await client.updateAlbum(a.album.id, a.userRenamed ? a.album.name : a.plan.name, desc);
	if (a.add.length) await client.addAssets(a.album.id, a.add);
	if (a.remove.length) await client.removeAssets(a.album.id, a.remove);
}

/** Writes the changed rows of `c`, or just `ids` of them. A failed row does not stop the rest. */
export async function applyActions(c: Computed, ids?: string[]): Promise<ApplyResponse> {
	const writable = c.actions.filter((a): a is Write => a.op !== 'noop');
	const wanted = ids ? new Set(ids) : null;
	if (wanted) {
		const known = new Set(writable.map(rowId));
		const unknown = [...wanted].filter((id) => !known.has(id));
		if (unknown.length) {
			throw new PreviewError(400, `not a changed row of this preview: ${unknown.join(', ')}`);
		}
	}
	const todo = writable.filter((a) => !wanted || wanted.has(rowId(a)));
	const client = c.live ? immichClient(c.cfg) : null;
	const results: ApplyResult[] = [];
	if (client) startJob('apply', 'albums', todo.length);
	for (const a of todo) {
		const row: ApplyResult = {
			id: rowId(a),
			op: a.op,
			name: a.op !== 'create' && a.userRenamed ? a.album.name : a.plan.name,
			add: a.op === 'create' ? a.plan.ids.length : a.add.length,
			remove: a.op === 'create' ? 0 : a.remove.length,
			ok: true
		};
		try {
			if (client) await write(client, c.cfg.immich.marker, a);
		} catch (e) {
			row.ok = false;
			row.error = (e as Error).message;
		}
		results.push(row);
		if (client) setJob({ done: results.length, label: row.name });
	}
	if (client) endJob(results.some((r) => !r.ok) ? `${results.filter((r) => !r.ok).length} failed` : undefined);
	// Albums changed, so the cached preview no longer describes Immich.
	if (client && results.some((r) => r.ok)) invalidate();
	return {
		dryRun: !client,
		applied: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).length,
		results
	};
}
