import type { Config, PlanKind, Scope } from '$core/types.js';

/** One reconcile action, flattened for the wire. Asset ids stay server side; only counts travel. */
export interface PreviewRow {
	/** `kind:key`, the handle POST /api/apply takes. */
	id: string;
	/** "rename" writes the title and the record, and moves no photos. */
	op: 'create' | 'update' | 'rename' | 'noop';
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
	/** First few asset ids, for the thumbnails in the list. */
	sample: string[];
}

export interface PreviewStats {
	assets: number;
	withGps: number;
	people: number;
	absorbed: number;
	managedAlbums: number;
	create: number;
	update: number;
	rename: number;
	noop: number;
}

export interface Preview {
	generatedAt: string;
	/** "immich" for a live library, "fixture" for the offline demo library. */
	source: 'immich' | 'fixture';
	windowStart: string;
	/** Digest of the rows. POST /api/apply refuses a token that is not the current one. */
	token: string;
	/** True when this came from an unsaved config, which apply refuses. */
	draft: boolean;
	/** "window" plans only what the rolling window covers in full, "all" the whole library. */
	scope: Scope;
	stats: PreviewStats;
	rows: PreviewRow[];
}

export interface ApplyRequest {
	token: string;
	confirm: true;
	/** Must match the preview the token came from. */
	scope?: Scope;
	/** The unsaved config the preview was planned from, when applying a draft. */
	config?: unknown;
	/** Row ids to write. Omitted means every changed row of the preview. */
	ids?: string[];
}

export interface ApplyResult {
	id: string;
	op: 'create' | 'update' | 'rename';
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

export interface GeoHit {
	name: string;
	detail?: string;
	lat: number;
	lon: number;
	/** "immich" is its own geodata, "nominatim" means the query left the network. */
	source: 'immich' | 'nominatim';
}

export interface AlbumAssets {
	id: string;
	name: string;
	/** Where the album's GPS photos were taken, capped. Empty for an album with no GPS. */
	points: { lat: number; lon: number }[];
	/** Asset ids the album will hold, capped; `total` is the real count. */
	ids: string[];
	total: number;
	add: string[];
	remove: string[];
}

export interface Job {
	phase: 'assets' | 'people' | 'albums' | 'apply';
	/** What is being worked on right now, for example the person or album being read. */
	label: string;
	done: number;
	/** 0 when the total is not known yet. */
	total: number;
	startedAt: number;
	endedAt?: number;
	error?: string;
}

/** What the sign in card needs to render. Never carries a token or a key. */
export interface AuthState {
	signedIn: boolean;
	source: 'session' | 'env' | 'none';
	email: string | null;
	expiresAt: string | null;
	/** Prefill for the URL field: the session's, the environment's, else the config's. */
	url: string;
	passwordLogin: boolean;
	oauth: boolean;
	/** Where Save would write, and whether it can. */
	envFile: string;
	envWritable: boolean;
	/** True when Immich could not be reached to ask about sign in methods. */
	unreachable?: string;
	/** DEMO=1 runs on the fixture library, so no credential is needed at all. */
	demo: boolean;
}

export interface SignInRequest {
	url: string;
	email: string;
	password: string;
}

export interface CheckResult {
	label: string;
	permission: string;
	ok: boolean;
	detail?: string;
}

export interface SignInResponse {
	email: string;
	expiresAt: string | null;
	checks: CheckResult[];
	swept: number;
}

/** The advanced path: a key minted for people who want a credential that outlives the process. */
export interface KeyResponse {
	secret: string;
	name: string;
	permissions: string[];
	untested: string[];
	checks: CheckResult[];
	envFile: string;
	envWritable: boolean;
}

export interface SaveKeyRequest {
	secret: string;
}
