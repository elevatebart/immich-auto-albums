import type { Config, PlanKind } from '$core/types.js';

/** One reconcile action, flattened for the wire. Asset ids stay server side; only counts travel. */
export interface PreviewRow {
	/** `kind:key`, the handle POST /api/apply takes. */
	id: string;
	op: 'create' | 'update' | 'noop';
	kind: PlanKind;
	key: string;
	/** Name the planner generated for this run. */
	name: string;
	start: string;
	assets: number;
	add: number;
	remove: number;
	/** The album gets renamed to `name` on apply. */
	rename: boolean;
	/** The user renamed the album by hand, so `albumName` is preserved on apply. */
	userRenamed: boolean;
	albumId?: string;
	albumName?: string;
	centroid?: { lat: number; lon: number };
}

export interface PreviewStats {
	assets: number;
	withGps: number;
	people: number;
	absorbed: number;
	managedAlbums: number;
	create: number;
	update: number;
	noop: number;
}

export interface Preview {
	generatedAt: string;
	/** "immich" for a live library, "fixture" for the offline demo library. */
	source: 'immich' | 'fixture';
	windowStart: string;
	/** Digest of the rows. POST /api/apply refuses a token that is not the current one. */
	token: string;
	stats: PreviewStats;
	rows: PreviewRow[];
}

export interface ApplyRequest {
	token: string;
	confirm: true;
	/** Row ids to write. Omitted means every changed row of the preview. */
	ids?: string[];
}

export interface ApplyResult {
	id: string;
	op: 'create' | 'update';
	name: string;
	add: number;
	remove: number;
	ok: boolean;
	error?: string;
}

export interface ApplyResponse {
	/** True when nothing was written, which is the case for the fixture library. */
	dryRun: boolean;
	applied: number;
	failed: number;
	results: ApplyResult[];
}

export interface ConfigResponse {
	file: string;
	/** Digest of the file on disk. PUT refuses a stale one. */
	etag: string;
	config: Config;
	toml: string;
}

export interface ConfigWriteRequest {
	etag: string;
	config: unknown;
	/** Validate and render the file without writing it. */
	dryRun?: boolean;
}

export interface ConfigWriteResponse extends ConfigResponse {
	dryRun: boolean;
	/** Legal changes worth reading twice, such as a new marker. */
	warnings: string[];
	backup?: string;
}

export interface Person {
	id: string;
	name: string;
}

export interface PeopleResponse {
	source: 'immich' | 'fixture';
	people: Person[];
}
