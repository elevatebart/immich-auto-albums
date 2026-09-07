import type { Asset, Config, Plan, Scope } from "./types.js";

// ---- time helpers (all UTC accessors; Asset.t encodes local time as UTC) ----
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3_600_000;

export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const mon = (d: Date) => MONTHS[d.getUTCMonth()];
const monYear = (d: Date) => `${mon(d)} ${d.getUTCFullYear()}`;
export const dayLabel = (d: Date) => `${pad(d.getUTCDate())} ${monYear(d)}`;

export function monthSpan(start: Date, end: Date): string {
  if (start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) return monYear(start);
  if (start.getUTCFullYear() === end.getUTCFullYear()) return `${mon(start)}-${monYear(end)}`;
  return `${monYear(start)} - ${monYear(end)}`;
}

// ---- geo ----
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export const hasGps = (a: Asset): a is Asset & { lat: number; lon: number } => a.lat !== null && a.lon !== null;

export function homeFor(cfg: Config, day: string): { lat: number; lon: number } {
  let home = cfg.homes[0];
  for (const h of cfg.homes) if (day >= h.from) home = h;
  return { lat: home.lat, lon: home.lon };
}

export function atHome(cfg: Config, a: Asset & { lat: number; lon: number }): boolean {
  const h = homeFor(cfg, dayOf(a.t));
  return haversineKm(a.lat, a.lon, h.lat, h.lon) <= cfg.clustering.homeKm;
}

// ---- clustering ----
export function clusterByGap<T extends Asset>(assets: T[], hours: number): T[][] {
  const sorted = [...assets].sort((x, y) => x.t.getTime() - y.t.getTime());
  const out: T[][] = [];
  let cur: T[] = [];
  for (const a of sorted) {
    if (cur.length && a.t.getTime() - cur[cur.length - 1].t.getTime() > hours * HOUR) {
      out.push(cur);
      cur = [];
    }
    cur.push(a);
  }
  if (cur.length) out.push(cur);
  return out;
}

interface Group {
  lat: number;
  lon: number;
  items: Asset[];
}

/** Greedy grouping around running centroids, largest first. */
export function subPlaces(cfg: Config, gps: (Asset & { lat: number; lon: number })[]): Group[] {
  const groups: Group[] = [];
  for (const a of gps) {
    const g = groups.find((g) => haversineKm(a.lat, a.lon, g.lat, g.lon) <= cfg.clustering.placeKm);
    if (g) {
      g.items.push(a);
      const n = g.items.length;
      g.lat += (a.lat - g.lat) / n;
      g.lon += (a.lon - g.lon) / n;
    } else groups.push({ lat: a.lat, lon: a.lon, items: [a] });
  }
  return groups.sort((x, y) => y.items.length - x.items.length);
}

export function normPlace(cfg: Config, name: string | null): string | null {
  if (!name) return null;
  if (/^Paris \d{2} /.test(name)) return "Paris";
  return cfg.aliases[name] ?? name;
}

function mostCommon(values: (string | null)[]): string | null {
  const c = new Map<string, number>();
  for (const v of values) if (v) c.set(v, (c.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of c) if (v > n) [best, n] = [k, v];
  return best;
}

const label = (cfg: Config, items: Asset[], field: "city" | "state" | "country" = "city") =>
  mostCommon(items.map((a) => normPlace(cfg, a[field])));

/** City if one place dominates, else state if all in one state, else country, else two countries. */
export function placeName(cfg: Config, cluster: Asset[]): string {
  const gps = cluster.filter(hasGps);
  const places: Group[] = [];
  for (const g of subPlaces(cfg, gps)) {
    const near = places.find((p) => haversineKm(g.lat, g.lon, p.lat, p.lon) <= cfg.clustering.mergeLabelKm);
    if (near) near.items.push(...g.items);
    else places.push({ ...g, items: [...g.items] });
  }
  places.sort((x, y) => y.items.length - x.items.length);
  if (!places.length) return "Trip";
  const top = places[0].items;
  if (top.length >= cfg.clustering.dominantShare * gps.length) {
    return label(cfg, top) ?? label(cfg, top, "state") ?? label(cfg, top, "country") ?? "Trip";
  }
  const states = new Set(places.map((p) => label(cfg, p.items, "state")).filter(Boolean));
  if (states.size === 1) return [...states][0]!;
  const countries = new Map<string, number>();
  for (const a of gps) {
    const c = normPlace(cfg, a.country);
    if (c) countries.set(c, (countries.get(c) ?? 0) + 1);
  }
  if (countries.size === 1) return [...countries.keys()][0];
  const top2 = [...countries.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([c]) => c);
  return top2.join(" & ") || "Trip";
}

export const joinNames = (names: string[]) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;

export function withPeople(cfg: Config, cluster: Asset[], place: string): string {
  const { noPeoplePlaces, household, withMinTagged, withShare, maxNamed } = cfg.people;
  if (noPeoplePlaces.includes(place)) return "";
  const tagged = cluster.filter((a) => a.people.size);
  if (tagged.length < withMinTagged) return "";
  const hh = new Set(household);
  const c = new Map<string, number>();
  for (const a of tagged) for (const p of a.people) if (!hh.has(p)) c.set(p, (c.get(p) ?? 0) + 1);
  const named = [...c.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, maxNamed)
    .filter(([, n]) => n >= withShare * tagged.length)
    .map(([p]) => p.split(" ")[0]);
  return named.length ? ` with ${joinNames(named)}` : "";
}

function centroid(cluster: Asset[]) {
  const gps = cluster.filter(hasGps);
  if (!gps.length) return undefined;
  return {
    lat: gps.reduce((s, a) => s + a.lat, 0) / gps.length,
    lon: gps.reduce((s, a) => s + a.lon, 0) / gps.length,
  };
}

// ---- rule engines ----
export interface PlanContext {
  cfg: Config;
  now: Date;
  windowStart: Date;
  /** "window" plans only what the window covers in full, "all" plans the whole library. */
  scope: Scope;
  /** GPS-less asset ids folded into trips; filled by planTrips, read by planSeasons. */
  absorbed: Set<string>;
}

export function makeContext(
  cfg: Config,
  now = new Date(),
  windowDays = cfg.immich.windowDays,
  scope: Scope = "all",
): PlanContext {
  return { cfg, now, windowStart: new Date(now.getTime() - windowDays * 24 * HOUR), scope, absorbed: new Set() };
}

/** A person year, season or event is planned only when the window holds all of it. */
const covered = (ctx: PlanContext, start: number) => ctx.scope === "all" || start >= ctx.windowStart.getTime();

export function planTrips(ctx: PlanContext, assets: Asset[]): Plan[] {
  const { cfg, windowStart, absorbed } = ctx;
  const inWindow = (a: Asset) => a.t >= windowStart;
  const away = assets.filter((a) => hasGps(a) && inWindow(a) && !atHome(cfg, a));
  const nogps = assets.filter((a) => !hasGps(a) && inWindow(a));
  const plans: Plan[] = [];
  for (const cl of clusterByGap(away, cfg.clustering.tripGapHours)) {
    const days = new Map<string, number>();
    for (const a of cl) days.set(dayOf(a.t), (days.get(dayOf(a.t)) ?? 0) + 1);
    const start = cl[0].t;
    const end = cl[cl.length - 1].t;
    if (cl.length >= cfg.clustering.tripMinPhotos && days.size >= cfg.clustering.tripMinDays) {
      const extra = nogps.filter((a) => a.t >= start && a.t <= end);
      for (const a of extra) absorbed.add(a.id);
      const full = [...cl, ...extra];
      const place = placeName(cfg, cl);
      plans.push({
        kind: "trip",
        key: dayOf(start),
        name: `${place}${withPeople(cfg, full, place)}, ${monthSpan(start, end)}`,
        ids: full.map((a) => a.id),
        start,
        centroid: centroid(cl),
      });
    } else {
      const [day, n] = [...days.entries()].sort((x, y) => y[1] - x[1])[0];
      if (n >= cfg.clustering.daytripMinPhotos) {
        plans.push({
          kind: "daytrip",
          key: day,
          name: `${placeName(cfg, cl)}, ${dayLabel(new Date(day))}`,
          ids: cl.map((a) => a.id),
          start,
          centroid: centroid(cl),
        });
      }
    }
  }
  return plans;
}

export function planGatherings(ctx: PlanContext, assets: Asset[]): Plan[] {
  const { cfg, windowStart } = ctx;
  const hh = new Set(cfg.people.household);
  const home = assets.filter((a) => hasGps(a) && a.t >= windowStart && atHome(cfg, a));
  const plans: Plan[] = [];
  for (const cl of clusterByGap(home, cfg.clustering.gatherGapHours)) {
    const guests = new Set<string>();
    for (const a of cl) for (const p of a.people) if (!hh.has(p)) guests.add(p);
    if (cl.length >= cfg.clustering.gatherMinPhotos && guests.size >= cfg.clustering.gatherMinGuests) {
      const d = cl[0].t;
      plans.push({
        kind: "gathering",
        key: dayOf(d),
        name: `Gathering at home, ${dayLabel(d)}`,
        ids: cl.map((a) => a.id),
        start: d,
        centroid: centroid(cl),
      });
    }
  }
  return plans;
}

/** How far back face tags must be fetched: the window's own reach, not the planned years. */
export function taggedSince(ctx: PlanContext): number {
  return Math.min(ctx.windowStart.getUTCFullYear(), ctx.now.getUTCFullYear() - 1);
}

/** Years a person album may be planned for. In window scope, only years the window holds in full. */
export function yearsCovered(ctx: PlanContext): number[] {
  const first = Math.min(ctx.windowStart.getUTCFullYear(), ctx.now.getUTCFullYear() - 1);
  const out: number[] = [];
  for (let y = first; y <= ctx.now.getUTCFullYear(); y++) {
    if (covered(ctx, Date.UTC(y, 0, 1))) out.push(y);
  }
  return out;
}

export function planPersonYears(ctx: PlanContext, assets: Asset[]): Plan[] {
  const { cfg } = ctx;
  const hh = new Set(cfg.people.household);
  const plans: Plan[] = [];
  for (const year of yearsCovered(ctx)) {
    const per = new Map<string, string[]>();
    for (const a of assets) {
      if (a.t.getUTCFullYear() !== year) continue;
      for (const p of a.people) (per.get(p) ?? per.set(p, []).get(p)!).push(a.id);
    }
    for (const [p, ids] of per) {
      const min = hh.has(p) ? cfg.personYears.householdMinPhotos : cfg.personYears.minPhotos;
      if (ids.length >= min) {
        plans.push({ kind: "person", key: `${p}:${year}`, name: `${p.split(" ")[0]} ${year}`, ids, start: new Date(Date.UTC(year, 0, 1)) });
      }
    }
  }
  return plans;
}

export function planSeasons(ctx: PlanContext, assets: Asset[]): Plan[] {
  const { cfg, absorbed } = ctx;
  const buckets = new Map<string, { season: string; year: number; ids: string[] }>();
  for (const a of assets) {
    if (hasGps(a) || dayOf(a.t) >= cfg.seasons.noGpsEraEnd || absorbed.has(a.id)) continue;
    const m = a.t.getUTCMonth() + 1;
    const d = a.t.getUTCDate();
    let season: string | null = null;
    let year = a.t.getUTCFullYear();
    if (m === 7 || m === 8) season = "Summer";
    else if ((m === 12 && d >= 20) || (m === 1 && d <= 5)) {
      season = "Christmas";
      if (m === 1) year -= 1;
    }
    if (!season) continue;
    const k = `${season}:${year}`;
    (buckets.get(k) ?? buckets.set(k, { season, year, ids: [] }).get(k)!).ids.push(a.id);
  }
  const bucketStart = (b: { season: string; year: number }) =>
    b.season === "Summer" ? Date.UTC(b.year, 6, 1) : Date.UTC(b.year, 11, 20);
  return [...buckets.entries()]
    .filter(([, b]) => b.ids.length >= cfg.seasons.minPhotos && covered(ctx, bucketStart(b)))
    .map(([key, b]) => ({ kind: "season" as const, key, name: `${b.season} ${b.year}`, ids: b.ids, start: new Date(Date.UTC(b.year, 0, 1)) }));
}

export function planFixedEvents(ctx: PlanContext, assets: Asset[]): Plan[] {
  return ctx.cfg.events.flatMap((e) => {
    if (!covered(ctx, Date.parse(`${e.from}T00:00:00Z`))) return [];
    const ids = assets.filter((a) => dayOf(a.t) >= e.from && dayOf(a.t) <= e.to).map((a) => a.id);
    if (!ids.length) return [];
    const start = new Date(e.from);
    return [{ kind: "event" as const, key: `${e.name}:${e.from}`, name: `${e.name}, ${monYear(start)}`, ids, start }];
  });
}

/** Full plan: every rule, sorted by start. */
export function plan(
  cfg: Config,
  assets: Asset[],
  opts: { now?: Date; windowDays?: number; scope?: Scope } = {},
): { plans: Plan[]; absorbed: Set<string> } {
  const ctx = makeContext(cfg, opts.now, opts.windowDays, opts.scope);
  const plans = [
    ...planTrips(ctx, assets),
    ...planGatherings(ctx, assets),
    ...planPersonYears(ctx, assets),
    ...planSeasons(ctx, assets),
    ...planFixedEvents(ctx, assets),
  ];
  plans.sort((x, y) => x.start.getTime() - y.start.getTime());
  return { plans, absorbed: ctx.absorbed };
}
