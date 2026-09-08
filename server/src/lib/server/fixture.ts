import { plan } from '$core/planner.js';
import type { Asset, Config, ManagedAlbum, PlanKind } from '$core/types.js';

/** Offline demo library, so the preview table can be worked on without a live Immich. */
const H = 3_600_000;
const DAY = 24 * H;

/** Departement per fixture town, standing in for the place lookup a live run does. */
const DISTRICTS: Record<string, string> = {
	Annecy: 'Haute-Savoie',
	Chamonix: 'Haute-Savoie',
	Lyon: 'Rhône',
	Grenoble: 'Isère'
};

let seq = 0;
const mk = (
	t: Date,
	lat: number | null,
	lon: number | null,
	city: string | null,
	people: string[] = []
): Asset => ({
	id: `fx${seq++}`,
	t,
	lat,
	lon,
	city,
	state: lat === null ? null : 'Rhône-Alpes',
	district: city === null ? null : (DISTRICTS[city] ?? null),
	country: lat === null ? null : 'France',
	people: new Set(people)
});

const burst = (start: Date, n: number, stepH: number, f: (t: Date, i: number) => Asset) =>
	Array.from({ length: n }, (_, i) => f(new Date(start.getTime() + i * stepH * H), i));

/** Household names come from the config, so the demo produces the same album kinds as a real run. */
export function fixtureAssets(now: Date, cfg: Config): Asset[] {
	seq = 0;
	const ago = (days: number) => new Date(now.getTime() - days * DAY);
	const [first = cfg.people.me, second = cfg.people.me] = cfg.people.household;
	return [
		// Annecy trip, plus GPS-less photos the planner should absorb into it.
		...burst(ago(30), 12, 6, (t, i) =>
			mk(t, 45.9, 6.13, 'Annecy', i < 8 ? [first, 'Alice Martin'] : [first])
		),
		...burst(ago(30), 20, 3, (t) => mk(t, null, null, null)),
		// Two day trips.
		...burst(ago(60), 16, 1 / 3, (t) => mk(t, 45.76, 4.84, 'Lyon')),
		...burst(ago(20), 18, 1 / 3, (t) => mk(t, 45.92, 6.87, 'Chamonix')),
		// Party at the Grenoble home with three guests.
		...burst(ago(90), 32, 1 / 12, (t) =>
			mk(t, 45.19, 5.72, 'Grenoble', ['Alice Martin', 'Bob Roy', 'Cara Li'])
		),
		// Household member, spread over the year, to trigger a person-year album.
		...burst(ago(200), 12, 24 * 7, (t) => mk(t, 45.19, 5.72, 'Grenoble', [second]))
	];
}

/** One role per kind, so the table shows every badge; plans with no role come out as creates. */
const ROLES: Partial<Record<PlanKind, { drop: number; rename?: 'user' | 'auto' }>> = {
	trip: { drop: 3 },
	gathering: { drop: 2, rename: 'user' },
	daytrip: { drop: 0, rename: 'auto' },
	person: { drop: 0 }
};

export function fixtureAlbums(cfg: Config, assets: Asset[], now: Date): ManagedAlbum[] {
	const taken = new Set<PlanKind>();
	const out: ManagedAlbum[] = [];
	for (const p of plan(cfg, assets, { now }).plans) {
		const role = ROLES[p.kind];
		if (!role || taken.has(p.kind)) continue;
		taken.add(p.kind);
		const stale = p.name.replace(/,[^,]*$/, ', last summer');
		out.push({
			id: `fxalb${out.length}`,
			name: role.rename === 'user' ? 'The big garden party' : role.rename === 'auto' ? stale : p.name,
			auto: role.rename === 'auto' ? stale : p.name,
			kind: p.kind,
			key: p.key,
			assets: new Set(role.drop ? p.ids.slice(0, -role.drop) : p.ids)
		});
	}
	return out;
}
