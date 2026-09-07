import { createHash } from 'node:crypto';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { loadConfig } from '$core/config.js';
import { ImmichClient } from '$core/immich.js';
import { dayOf, makeContext, plan, yearsCovered } from '$core/planner.js';
import { reconcile } from '$core/reconcile.js';
import type { Action, Asset, Config, ManagedAlbum } from '$core/types.js';
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
}

export function immichClient(cfg: Config): ImmichClient {
	if (!env.IMMICH_API_KEY) throw new PreviewError(503, 'IMMICH_API_KEY is not set');
	return new ImmichClient(env.IMMICH_URL ?? cfg.immich.url, env.IMMICH_API_KEY);
}

async function fromImmich(cfg: Config, now: Date, windowDays: number): Promise<Snapshot> {
	const client = immichClient(cfg);
	try {
		await client.checkAuth();
	} catch (e) {
		const url = env.IMMICH_URL ?? cfg.immich.url;
		throw new PreviewError(502, `Immich at ${url} is unreachable or rejected the API key: ${(e as Error).message}`);
	}
	const assets = await client.fetchAssets();
	const people = await client.fetchPeople();
	const ctx = makeContext(cfg, now, windowDays);
	await client.attachPeople(assets, people, yearsCovered(ctx)[0]);
	return {
		source: 'immich',
		assets: [...assets.values()],
		albums: await client.fetchManagedAlbums(cfg.immich.marker),
		people: people.length
	};
}

function fromFixture(cfg: Config, now: Date): Snapshot {
	const assets = fixtureAssets(now);
	const names = new Set(assets.flatMap((a) => [...a.people]));
	return { source: 'fixture', assets, albums: fixtureAlbums(cfg, assets, now), people: names.size };
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
	centroid: a.plan.centroid
});

/** Digest of what apply would do, so a stale confirm can be rejected. */
const tokenOf = (rows: PreviewRow[]) =>
	createHash('sha256')
		.update(JSON.stringify(rows.map((r) => [r.id, r.op, r.name, r.assets, r.add, r.remove, r.albumId])))
		.digest('hex')
		.slice(0, 16);

async function compute(): Promise<Computed> {
	const cfg = await loadConfig(configPath());
	const now = new Date();
	const windowDays = Number(env.WINDOW_DAYS ?? cfg.immich.windowDays);
	if (!env.IMMICH_API_KEY && env.DEMO !== '1') {
		throw new PreviewError(503, 'IMMICH_API_KEY is not set. Set it, or run with DEMO=1 for the fixture library.');
	}
	const snap = env.IMMICH_API_KEY ? await fromImmich(cfg, now, windowDays) : fromFixture(cfg, now);

	const { plans, absorbed } = plan(cfg, snap.assets, { now, windowDays });
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
			windowStart: dayOf(makeContext(cfg, now, windowDays).windowStart),
			token: tokenOf(rows),
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

let cached: { at: number; value: Computed } | null = null;
let inflight: Promise<Computed> | null = null;

/** A full library scan is slow, so hold the last result and coalesce concurrent requests. */
export function getComputed(refresh = false): Promise<Computed> {
	if (!refresh && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
	inflight ??= compute()
		.then((value) => {
			cached = { at: Date.now(), value };
			return value;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

export const getPreview = (refresh = false) => getComputed(refresh).then((c) => c.data);

export const invalidate = () => {
	cached = null;
};
