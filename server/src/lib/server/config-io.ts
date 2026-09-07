import { createHash } from 'node:crypto';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { fromToml, toToml } from '$core/config.js';
import type { Config, PlanKind } from '$core/types.js';
import { configPath, invalidate, PreviewError } from './preview';

export interface Issue {
	field: string;
	message: string;
}

export const etagOf = (text: string) =>
	createHash('sha256').update(text).digest('hex').slice(0, 16);

export async function readConfigFile() {
	const file = configPath();
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (e) {
		const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
		throw new PreviewError(missing ? 404 : 500, `cannot read ${file}: ${(e as Error).message}`);
	}
	try {
		return { file, text, etag: etagOf(text), config: fromToml(text) };
	} catch (e) {
		throw new PreviewError(500, `${file} is not valid: ${(e as Error).message}`);
	}
}

/** Backup first, then write through a temp file in the same directory so the swap is atomic. */
export async function writeConfigFile(next: Config, etag: string) {
	const current = await readConfigFile();
	if (etag !== current.etag) {
		throw new PreviewError(409, 'config.toml changed on disk since you loaded it. Reload, then edit again.');
	}
	const text = toToml(next);
	await copyFile(current.file, `${current.file}.bak`);
	await writeFile(`${current.file}.tmp`, text);
	await rename(`${current.file}.tmp`, current.file);
	invalidate();
	return { file: current.file, text, etag: etagOf(text), backup: `${current.file}.bak` };
}

/** Changes that are legal but cost the user something, so the UI can say so before the write. */
export function warningsFor(current: Config, next: Config): string[] {
	const out: string[] = [];
	if (current.immich.marker !== next.immich.marker) {
		out.push(
			`Changing the marker to ${next.immich.marker} orphans the albums tagged ${current.immich.marker}: they stop being found, and the next apply creates new ones.`
		);
	}
	if (next.immich.windowDays < current.immich.windowDays) {
		out.push(
			`The window shrinks from ${current.immich.windowDays} to ${next.immich.windowDays} days, so trips and gatherings before that fall out of the plan. Existing albums are left alone.`
		);
	}
	return out;
}

const KINDS: PlanKind[] = ['trip', 'daytrip', 'gathering', 'person', 'season', 'event'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads an untrusted body into a Config, collecting every problem instead of throwing on the first. */
export function parseConfig(raw: unknown): { config: Config; issues: Issue[] } {
	const issues: Issue[] = [];
	const bad = (field: string, message: string) => {
		issues.push({ field, message });
	};
	const obj = (v: unknown, field: string): Record<string, unknown> => {
		if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
		bad(field, 'expected an object');
		return {};
	};
	const num = (v: unknown, field: string, min: number, max: number, fallback = min) => {
		if (typeof v !== 'number' || !Number.isFinite(v)) return bad(field, 'expected a number'), fallback;
		if (v < min || v > max) return bad(field, `expected ${min} to ${max}`), fallback;
		return v;
	};
	const str = (v: unknown, field: string, fallback = '') => {
		if (typeof v !== 'string' || !v.trim()) return bad(field, 'expected a non-empty string'), fallback;
		return v;
	};
	const strs = (v: unknown, field: string): string[] => {
		if (!Array.isArray(v)) return bad(field, 'expected an array of strings'), [];
		return v.map((x, i) => str(x, `${field}[${i}]`));
	};
	const day = (v: unknown, field: string, fallback = '1970-01-01') => {
		if (typeof v !== 'string' || !DAY_RE.test(v)) return bad(field, 'expected a YYYY-MM-DD date'), fallback;
		if (Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return bad(field, 'not a real date'), fallback;
		return v;
	};
	const rows = (v: unknown, field: string): Record<string, unknown>[] => {
		if (v === undefined) return [];
		if (!Array.isArray(v)) return bad(field, 'expected an array'), [];
		return v.map((x, i) => obj(x, `${field}[${i}]`));
	};

	const c = obj(raw, 'config');
	const im = obj(c.immich, 'immich');
	const pe = obj(c.people, 'people');
	const cl = obj(c.clustering, 'clustering');
	const py = obj(c.personYears, 'personYears');
	const se = obj(c.seasons, 'seasons');

	const homes = rows(c.homes, 'homes').map((h, i) => ({
		from: day(h.from, `homes[${i}].from`),
		lat: num(h.lat, `homes[${i}].lat`, -90, 90),
		lon: num(h.lon, `homes[${i}].lon`, -180, 180),
		label: typeof h.label === 'string' && h.label ? h.label : undefined
	}));
	if (!homes.length) bad('homes', 'at least one home is required');
	for (let i = 1; i < homes.length; i++) {
		if (homes[i].from < homes[i - 1].from) bad(`homes[${i}].from`, 'homes must be in chronological order');
	}

	const from = pe.noPeopleFrom;
	const to = pe.noPeopleTo;
	if ((from === undefined) !== (to === undefined)) {
		bad('people.noPeopleFrom', 'set both noPeopleFrom and noPeopleTo, or neither');
	}

	const aliases: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj(c.aliases ?? {}, 'aliases'))) {
		aliases[str(k, `aliases key ${k}`)] = str(v, `aliases.${k}`);
	}

	const config: Config = {
		immich: {
			url: str(im.url, 'immich.url'),
			outDir: str(im.outDir, 'immich.outDir'),
			windowDays: num(im.windowDays, 'immich.windowDays', 1, 36500, 365),
			marker: str(im.marker, 'immich.marker')
		},
		people: {
			me: str(pe.me, 'people.me'),
			household: strs(pe.household, 'people.household'),
			withShare: num(pe.withShare, 'people.withShare', 0, 1),
			withMinTagged: num(pe.withMinTagged, 'people.withMinTagged', 0, 10000),
			maxNamed: num(pe.maxNamed, 'people.maxNamed', 1, 20, 3),
			noPeopleFrom: from === undefined ? undefined : day(from, 'people.noPeopleFrom'),
			noPeopleTo: to === undefined ? undefined : day(to, 'people.noPeopleTo'),
			noPeoplePlaces: strs(pe.noPeoplePlaces ?? [], 'people.noPeoplePlaces')
		},
		homes,
		clustering: {
			homeKm: num(cl.homeKm, 'clustering.homeKm', 0.1, 500, 20),
			placeKm: num(cl.placeKm, 'clustering.placeKm', 0.1, 500, 5),
			mergeLabelKm: num(cl.mergeLabelKm, 'clustering.mergeLabelKm', 0.1, 500, 15),
			dominantShare: num(cl.dominantShare, 'clustering.dominantShare', 0, 1, 0.75),
			tripGapHours: num(cl.tripGapHours, 'clustering.tripGapHours', 1, 8760, 72),
			tripMinPhotos: num(cl.tripMinPhotos, 'clustering.tripMinPhotos', 1, 10000, 10),
			tripMinDays: num(cl.tripMinDays, 'clustering.tripMinDays', 1, 365, 2),
			daytripMinPhotos: num(cl.daytripMinPhotos, 'clustering.daytripMinPhotos', 1, 10000, 15),
			gatherGapHours: num(cl.gatherGapHours, 'clustering.gatherGapHours', 0.1, 168, 2),
			gatherMinPhotos: num(cl.gatherMinPhotos, 'clustering.gatherMinPhotos', 1, 10000, 30),
			gatherMinGuests: num(cl.gatherMinGuests, 'clustering.gatherMinGuests', 1, 100, 3)
		},
		personYears: {
			minPhotos: num(py.minPhotos, 'personYears.minPhotos', 1, 100000, 50),
			householdMinPhotos: num(py.householdMinPhotos, 'personYears.householdMinPhotos', 1, 100000, 10)
		},
		seasons: {
			noGpsEraEnd: day(se.noGpsEraEnd, 'seasons.noGpsEraEnd'),
			minPhotos: num(se.minPhotos, 'seasons.minPhotos', 1, 100000, 5)
		},
		aliases,
		events: rows(c.events, 'events').map((e, i) => {
			const ev = {
				name: str(e.name, `events[${i}].name`),
				from: day(e.from, `events[${i}].from`),
				to: day(e.to, `events[${i}].to`)
			};
			if (ev.to < ev.from) bad(`events[${i}].to`, 'must not be before from');
			return ev;
		}),
		overrides: rows(c.overrides, 'overrides').map((o, i) => ({
			kind: KINDS.includes(o.kind as PlanKind)
				? (o.kind as PlanKind)
				: (bad(`overrides[${i}].kind`, `expected one of ${KINDS.join(', ')}`), 'trip'),
			keyPrefix: str(o.keyPrefix, `overrides[${i}].keyPrefix`),
			name: str(o.name, `overrides[${i}].name`)
		}))
	};
	return { config, issues };
}
