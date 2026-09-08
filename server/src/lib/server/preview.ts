import { createHash } from 'node:crypto';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { loadConfig } from '$core/config.js';
import { ImmichClient, ImmichHttpError } from '$core/immich.js';
import { dayOf, makeContext, plan } from '$core/planner.js';
import { reconcile } from '$core/reconcile.js';
import type { Action, Asset, Config, ManagedAlbum, Scope } from '$core/types.js';
import type { Preview, PreviewRow } from '$lib/types';
import { credential, immichUrl } from './credentials.js';
import { fixtureAlbums, fixtureAssets } from './fixture.js';
import { endJob, setJob, startJob } from './progress.js';

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
	/** Coordinates of the GPS assets, so an album can be drawn on a map. */
	gps: Map<string, { lat: number; lon: number }>;
}

interface Snapshot {
	source: 'immich' | 'fixture';
	assets: Asset[];
	albums: ManagedAlbum[];
	people: number;
	/** Frozen so a re-plan of the same library lands on the same window. */
	now: Date;
	/** How far back the fetch reached. null is the whole library. Nothing older than this exists here. */
	since: Date | null;
}

export function immichClient(cfg: Config): ImmichClient {
	const cred = credential();
	if (!cred) throw new PreviewError(503, notSignedIn);
	return new ImmichClient(immichUrl(cfg), cred);
}

export const notSignedIn = 'Not signed in to Immich.';

async function fromImmich(cfg: Config, now: Date, since: Date | null): Promise<Snapshot> {
	const client = immichClient(cfg);
	try {
		await client.checkAuth();
	} catch (e) {
		const url = immichUrl(cfg);
		const status = e instanceof ImmichHttpError ? e.status : 0;
		if (status === 401) throw new PreviewError(401, 'Immich rejected the credentials. Sign in again.');
		throw new PreviewError(502, `Immich at ${url} is unreachable: ${(e as Error).message}`);
	}
	startJob('assets', since ? `photos since ${since.toISOString().slice(0, 10)}` : 'every photo');
	// This Immich returns the page's own total, so only a figure above the count is a real total.
	const assets = await client.fetchAssets(since ?? undefined, (done, total) =>
		setJob({ done, total: total > done ? total : 0 })
	);
	startJob('people', 'named people');
	const people = await client.fetchPeople();
	// Face tags reach a year further back than the assets, so a trip near the edge keeps its guests.
	await client.attachPeople(assets, people, (since ?? new Date(0)).getUTCFullYear(), (done, total, name) =>
		setJob({ done, total, label: name })
	);
	startJob('albums', 'albums this tool manages');
	const albums = await client.fetchManagedAlbums(cfg.immich.marker, (done, total, name) =>
		setJob({ done, total, label: name })
	);
	return {
		source: 'immich',
		assets: [...assets.values()],
		albums,
		people: people.length,
		now,
		since
	};
}

function fromFixture(cfg: Config, now: Date): Snapshot {
	const assets = fixtureAssets(now, cfg);
	const names = new Set(assets.flatMap((a) => [...a.people]));
	return { source: 'fixture', assets, albums: fixtureAlbums(cfg, assets, now), people: names.size, now, since: null };
}

export const rowId = (a: Action) => `${a.plan.kind}:${a.plan.key}`;

const rowOf = (a: Action): PreviewRow => {
	const moves = a.op === 'update' || a.op === 'rename';
	return {
		id: rowId(a),
		op: a.op,
		kind: a.plan.kind,
		key: a.plan.key,
		name: a.plan.name,
		start: dayOf(a.plan.start),
		assets: a.plan.ids.length,
		add: moves ? a.add.length : a.op === 'create' ? a.plan.ids.length : 0,
		remove: moves ? a.remove.length : 0,
		rename: moves && a.rename,
		userRenamed: moves && a.userRenamed,
		albumId: a.op === 'create' ? undefined : a.album.id,
		albumName: a.op === 'create' ? undefined : a.album.name,
		// Enough for the strip in the list. The modal asks for the rest.
		sample: a.plan.ids.slice(0, 4)
	};
};

/** Digest of what apply would do, so a stale confirm can be rejected. */
const tokenOf = (rows: PreviewRow[]) =>
	createHash('sha256')
		.update(JSON.stringify(rows.map((r) => [r.id, r.op, r.name, r.assets, r.add, r.remove, r.albumId])))
		.digest('hex')
		.slice(0, 16);

/** How far back a plan for this config needs the library. null means the whole thing. */
function reachOf(cfg: Config, scope: Scope, now: Date): Date | null {
	if (scope === 'all') return null;
	const windowDays = Number(env.WINDOW_DAYS ?? cfg.immich.windowDays);
	return makeContext(cfg, now, windowDays, scope).windowStart;
}

async function readSnapshot(since: Date | null): Promise<Snapshot> {
	const now = new Date();
	if (!credential() && env.DEMO !== '1') throw new PreviewError(503, notSignedIn);
	const cfg = await readConfig();
	if (!credential()) return fromFixture(cfg, now);
	try {
		const snap = await fromImmich(cfg, now, since);
		endJob();
		return snap;
	} catch (e) {
		endJob((e as Error).message);
		throw e;
	}
}

/** Plan and reconcile over a snapshot already in memory. Microseconds, so a draft config is cheap. */
function planWith(snapshot: Snapshot, cfg: Config, draft: boolean, scope: Scope): Computed {
	// The fixture reads the config, so rebuild it for a draft rather than showing stale names.
	const snap = snapshot.source === 'fixture' ? fromFixture(cfg, snapshot.now) : snapshot;
	const now = snap.now;
	// Never plan past what the snapshot holds: a window reaching further back would see a truncated
	// year and ask reconcile to strip the missing photos out of an album a full run had created.
	const asked = Number(env.WINDOW_DAYS ?? cfg.immich.windowDays);
	const reach = snap.since ? (now.getTime() - snap.since.getTime()) / (24 * 3_600_000) : asked;
	const windowDays = scope === 'all' ? asked : Math.min(asked, reach);
	const { plans, absorbed } = plan(cfg, snap.assets, { now, windowDays, scope });
	const actions = reconcile(plans, snap.albums);
	const rows = actions.map(rowOf);
	const count = (op: PreviewRow['op']) => rows.filter((r) => r.op === op).length;
	const gps = new Map<string, { lat: number; lon: number }>();
	for (const a of snap.assets) {
		if (a.lat !== null && a.lon !== null) gps.set(a.id, { lat: a.lat, lon: a.lon });
	}
	return {
		cfg,
		actions,
		live: snap.source === 'immich',
		gps,
		data: {
			generatedAt: now.toISOString(),
			source: snap.source,
			windowStart: dayOf(makeContext(cfg, now, windowDays, scope).windowStart),
			scope,
			// A draft is applicable too, and its token is checked the same way: the server replans the
			// same config and compares. What differs is that the monthly run keeps using the saved config.
			token: tokenOf(rows),
			draft,
			stats: {
				assets: snap.assets.length,
				withGps: snap.assets.filter((a) => a.lat !== null).length,
				people: snap.people,
				absorbed: absorbed.size,
				managedAlbums: snap.albums.length,
				create: count('create'),
				update: count('update'),
				rename: count('rename'),
				noop: count('noop')
			},
			rows
		}
	};
}

/** One snapshot at a time, with the reach it was fetched for. */
let cached: { at: number; value: Snapshot } | null = null;
let inflight: { since: Date | null; run: Promise<Snapshot> } | null = null;

const holds = (snap: Snapshot, since: Date | null) =>
	snap.since === null || (since !== null && since.getTime() >= snap.since.getTime());

/**
 * A library scan is slow, so hold the last one. A plan that needs the library further back than the
 * snapshot reaches gets a fresh one; a shorter reach reuses it, since the planner filters anyway.
 */
async function getSnapshot(since: Date | null, refresh = false): Promise<Snapshot> {
	if (!refresh && cached && Date.now() - cached.at < TTL_MS && holds(cached.value, since)) {
		return cached.value;
	}
	if (!inflight || !holds({ since: inflight.since } as Snapshot, since)) {
		const run = readSnapshot(since)
			.then((value) => {
				cached = { at: Date.now(), value };
				return value;
			})
			.finally(() => {
				if (inflight?.run === run) inflight = null;
			});
		inflight = { since, run };
	}
	return inflight.run;
}

/** The plan for the config on disk. This is the only one apply will write. */
export async function getComputed(scope: Scope = 'window', refresh = false): Promise<Computed> {
	const cfg = await readConfig();
	const snap = await getSnapshot(reachOf(cfg, scope, new Date()), refresh);
	return planWith(snap, cfg, false, scope);
}

/** The plan for an unsaved config. It may need the library further back than the saved one does. */
export async function getDraft(cfg: Config, scope: Scope = 'window'): Promise<Computed> {
	const snap = await getSnapshot(reachOf(cfg, scope, new Date()));
	return planWith(snap, cfg, true, scope);
}

export const getPreview = (scope: Scope = 'window', refresh = false) =>
	getComputed(scope, refresh).then((c) => c.data);

export const invalidate = () => {
	cached = null;
};
