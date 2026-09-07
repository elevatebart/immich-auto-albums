import { createHash } from 'node:crypto';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { loadConfig } from '$core/config.js';
import { ImmichClient } from '$core/immich.js';
import { dayOf, makeContext, plan, taggedSince } from '$core/planner.js';
import { reconcile } from '$core/reconcile.js';
import type { Action, Asset, Config, ManagedAlbum, Scope } from '$core/types.js';
import type { Preview, PreviewRow } from '$lib/types';
import { fixtureAlbums, fixtureAssets } from './fixture.js';

const TTL_MS = 10 * 60_000;

export class PreviewError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

/** Config path is relative to the process cwd, which is server/ in dev and in the adapter-node build. */
export const configPath = () => path.resolve(env.CONFIG ?? '../config.toml');

export const missingConfig = (file: string) =>
	`no config at ${file}. Copy config.example.toml to config.toml, or set CONFIG.`;

/** Same 404 and the same hint wherever the config is read. */
export async function readConfig(): Promise<Config> {
	const file = configPath();
	try {
		return await loadConfig(file);
	} catch (e) {
		const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
		throw new PreviewError(missing ? 404 : 500, missing ? missingConfig(file) : `${file} is not valid: ${(e as Error).message}`);
	}
}

/** The wire preview plus the actions behind it, which keep the asset ids apply needs. */
export interface Computed {
	data: Preview;
	actions: Action[];
	cfg: Config;
	live: boolean;
}

interface Snapshot {
	source: 'immich' | 'fixture';
	assets: Asset[];
	albums: ManagedAlbum[];
	people: number;
	/** Frozen so a re-plan of the same library lands on the same window. */
	now: Date;
}

export function immichClient(cfg: Config): ImmichClient {
	if (!env.IMMICH_API_KEY) throw new PreviewError(503, 'IMMICH_API_KEY is not set');
	return new ImmichClient(env.IMMICH_URL ?? cfg.immich.url, env.IMMICH_API_KEY);
}

async function fromImmich(cfg: Config, now: Date, windowDays: number, scope: Scope): Promise<Snapshot> {
	const client = immichClient(cfg);
	try {
		await client.checkAuth();
	} catch (e) {
		const url = env.IMMICH_URL ?? cfg.immich.url;
		throw new PreviewError(502, `Immich at ${url} is unreachable or rejected the API key: ${(e as Error).message}`);
	}
	const ctx = makeContext(cfg, now, windowDays, scope);
	const assets = await client.fetchAssets(scope === 'window' ? ctx.windowStart : undefined);
	const people = await client.fetchPeople();
	await client.attachPeople(assets, people, taggedSince(ctx));
	return {
		source: 'immich',
		assets: [...assets.values()],
		albums: await client.fetchManagedAlbums(cfg.immich.marker),
		people: people.length,
		now
	};
}

function fromFixture(cfg: Config, now: Date): Snapshot {
	const assets = fixtureAssets(now, cfg);
	const names = new Set(assets.flatMap((a) => [...a.people]));
	return { source: 'fixture', assets, albums: fixtureAlbums(cfg, assets, now), people: names.size, now };
}

export const rowId = (a: Action) => `${a.plan.kind}:${a.plan.key}`;

const rowOf = (a: Action): PreviewRow => ({
	id: rowId(a),
	op: a.op,
	kind: a.plan.kind,
	key: a.plan.key,
	name: a.plan.name,
	start: dayOf(a.plan.start),
	assets: a.plan.ids.length,
	add: a.op === 'update' ? a.add.length : a.op === 'create' ? a.plan.ids.length : 0,
	remove: a.op === 'update' ? a.remove.length : 0,
	rename: a.op === 'update' && a.rename,
	userRenamed: a.op === 'update' && a.userRenamed,
	albumId: a.op === 'create' ? undefined : a.album.id,
	albumName: a.op === 'create' ? undefined : a.album.name,
	centroid: a.plan.centroid,
	// Enough for the strip in the list. The modal asks for the rest.
	sample: a.plan.ids.slice(0, 4)
});

/** Digest of what apply would do, so a stale confirm can be rejected. */
const tokenOf = (rows: PreviewRow[]) =>
	createHash('sha256')
		.update(JSON.stringify(rows.map((r) => [r.id, r.op, r.name, r.assets, r.add, r.remove, r.albumId])))
		.digest('hex')
		.slice(0, 16);

async function readSnapshot(cfg: Config, scope: Scope): Promise<Snapshot> {
	const now = new Date();
	if (!env.IMMICH_API_KEY && env.DEMO !== '1') {
		throw new PreviewError(503, 'IMMICH_API_KEY is not set. Set it, or run with DEMO=1 for the fixture library.');
	}
	const windowDays = Number(env.WINDOW_DAYS ?? cfg.immich.windowDays);
	return env.IMMICH_API_KEY ? await fromImmich(cfg, now, windowDays, scope) : fromFixture(cfg, now);
}

/** Plan and reconcile over a snapshot already in memory. Microseconds, so a draft config is cheap. */
function planWith(snapshot: Snapshot, cfg: Config, draft: boolean, scope: Scope): Computed {
	// The fixture reads the config, so rebuild it for a draft rather than showing stale names.
	const snap = snapshot.source === 'fixture' ? fromFixture(cfg, snapshot.now) : snapshot;
	const now = snap.now;
	const windowDays = Number(env.WINDOW_DAYS ?? cfg.immich.windowDays);
	const { plans, absorbed } = plan(cfg, snap.assets, { now, windowDays, scope });
	const actions = reconcile(plans, snap.albums);
	const rows = actions.map(rowOf);
	const count = (op: PreviewRow['op']) => rows.filter((r) => r.op === op).length;
	return {
		cfg,
		actions,
		live: snap.source === 'immich',
		data: {
			generatedAt: now.toISOString(),
			source: snap.source,
			windowStart: dayOf(makeContext(cfg, now, windowDays, scope).windowStart),
			scope,
			// Only a plan from the saved config can be applied, so a draft carries no token.
			token: draft ? '' : tokenOf(rows),
			draft,
			stats: {
				assets: snap.assets.length,
				withGps: snap.assets.filter((a) => a.lat !== null).length,
				people: snap.people,
				absorbed: absorbed.size,
				managedAlbums: snap.albums.length,
				create: count('create'),
				update: count('update'),
				noop: count('noop')
			},
			rows
		}
	};
}

/** One entry per scope: the windowed scan fetches less, so the two are not interchangeable. */
const cached = new Map<Scope, { at: number; value: Snapshot }>();
const inflight = new Map<Scope, Promise<Snapshot>>();

/** A library scan is slow, so hold the last one per scope and coalesce concurrent requests. */
async function getSnapshot(scope: Scope, refresh = false): Promise<Snapshot> {
	const hit = cached.get(scope);
	if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
	if (!inflight.has(scope)) {
		inflight.set(
			scope,
			readConfig()
				.then((cfg) => readSnapshot(cfg, scope))
				.then((value) => {
					cached.set(scope, { at: Date.now(), value });
					return value;
				})
				.finally(() => inflight.delete(scope))
		);
	}
	return inflight.get(scope)!;
}

/** The plan for the config on disk. This is the only one apply will write. */
export async function getComputed(scope: Scope = 'window', refresh = false): Promise<Computed> {
	const cfg = await readConfig();
	return planWith(await getSnapshot(scope, refresh), cfg, false, scope);
}

/** The plan for an unsaved config, over the cached library. */
export async function getDraft(cfg: Config, scope: Scope = 'window'): Promise<Computed> {
	return planWith(await getSnapshot(scope), cfg, true, scope);
}

export const getPreview = (scope: Scope = 'window', refresh = false) =>
	getComputed(scope, refresh).then((c) => c.data);

export const invalidate = () => cached.clear();
