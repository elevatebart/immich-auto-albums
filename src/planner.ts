import type { Asset, Config, FixedEvent, Plan, PlanKind, Scope, Zone } from "./types.js";

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

/** Counts non-null values. */
function counted(values: (string | null | undefined)[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const v of values) if (v) c.set(v, (c.get(v) ?? 0) + 1);
  return c;
}

/** The most frequent non-null value with its count. */
function commonest(values: (string | null | undefined)[]): [string, number] | null {
  const c = counted(values);
  let best: [string, number] | null = null;
  for (const [k, v] of c) if (!best || v > best[1]) best = [k, v];
  return best;
}

const mostCommon = (values: (string | null)[]): string | null => commonest(values)?.[0] ?? null;

const label = (cfg: Config, items: Asset[], field: "city" | "state" | "country" = "city") =>
  mostCommon(items.map((a) => normPlace(cfg, a[field])));

/** Zones sharing a name are one area, so a range can be several circles that miss the valley between. */
function zoneCircles(cfg: Config): [string, Zone[]][] {
  const byName = new Map<string, Zone[]>();
  for (const z of cfg.zones) byName.set(z.name, [...(byName.get(z.name) ?? []), z]);
  const widest = (zs: Zone[]) => Math.max(...zs.map((z) => z.km));
  return [...byName].sort((x, y) => widest(x[1]) - widest(y[1]));
}

/** The tightest zone holding `zoneShare` of the photos, so it beats the district. */
function zoneName(cfg: Config, gps: (Asset & { lat: number; lon: number })[]): string | null {
  const need = cfg.clustering.zoneShare * gps.length;
  for (const [name, circles] of zoneCircles(cfg)) {
    const inside = gps.filter((a) => circles.some((z) => haversineKm(a.lat, a.lon, z.lat, z.lon) <= z.km));
    if (inside.length >= need) return name;
  }
  return null;
}

/** True when this country names albums after districts and this region is not one of the keepers. */
function prefersDistricts(cfg: Config, gps: Asset[], region: string): boolean {
  const keep = cfg.naming.keepRegions;
  if (keep.includes(region) || keep.includes(normPlace(cfg, region)!)) return false;
  const country = commonest(gps.map((a) => a.country));
  return !!country && cfg.naming.districtCountries.includes(country[0]);
}

/** One district holding `need` photos, else the top two together, so "Isere & Drome". */
function districtName(cfg: Config, gps: Asset[], need: number): string | null {
  const top = [...counted(gps.map((a) => a.district ?? null))].sort((x, y) => y[1] - x[1]);
  if (!top.length) return null;
  if (top[0][1] >= need) return normPlace(cfg, top[0][0]);
  if (top.length > 1 && top[0][1] + top[1][1] >= need) {
    return top.slice(0, 2).map(([d]) => normPlace(cfg, d)).join(" & ");
  }
  return null;
}

/** Above city level: the district when the country prefers it, else the region. */
function areaName(cfg: Config, gps: Asset[], share: number): string | null {
  const need = share * gps.length;
  const region = commonest(gps.map((a) => a.state));
  const enough = !!region && region[1] >= need;
  if (enough && !prefersDistricts(cfg, gps, region[0])) return normPlace(cfg, region[0]);
  return districtName(cfg, gps, need) ?? (enough ? normPlace(cfg, region[0]) : null);
}

/** City if one place dominates, else district or region, else country, else two countries. */
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
    return label(cfg, top) ?? areaName(cfg, top, 0) ?? label(cfg, top, "country") ?? "Trip";
  }
  // One area holding most of the photos names the trip on its own; the rest is a detour.
  const area = zoneName(cfg, gps) ?? areaName(cfg, gps, cfg.clustering.regionShare);
  if (area) return area;
  const countries = counted(gps.map((a) => normPlace(cfg, a.country)));
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
  // "all" means no window at all, so trips and gatherings reach back as far as the library does.
  const windowStart = scope === "all" ? new Date(0) : new Date(now.getTime() - windowDays * 24 * HOUR);
  return { cfg, now, windowStart, scope, absorbed: new Set() };
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
  // Without a window, the years to consider come from the library rather than from the window's reach.
  const years =
    ctx.scope === "all"
      ? [...new Set(assets.map((a) => a.t.getUTCFullYear()))].sort()
      : yearsCovered(ctx);
  for (const year of years) {
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

const CLUSTER_KINDS: PlanKind[] = ["trip", "daytrip", "gathering"];

/** A cluster plan dropped in favour of a hand-declared event, and the event that took it. */
export interface Fold {
  event: string;
  plan: Plan;
}

/**
 * A cluster with `event_absorb_share` of both its photos and its days inside a hand-declared event is
 * that event, so drop it and hand its photos over. The test is the range, not the event plan.
 */
export function foldIntoEvents(
  ctx: PlanContext,
  assets: Asset[],
  plans: Plan[],
): { plans: Plan[]; folded: Fold[] } {
  const { cfg } = ctx;
  if (!cfg.events.length) return { plans, folded: [] };
  const k = cfg.clustering.eventAbsorbShare;
  const day = new Map(assets.map((a) => [a.id, dayOf(a.t)]));
  const events = new Map(plans.filter((p) => p.kind === "event").map((p) => [p.key, p]));
  // Narrowest range first, then earliest, then by name: a tie goes to the most specific event.
  const span = (e: FixedEvent) => Date.parse(e.to) - Date.parse(e.from);
  const ordered = [...cfg.events].sort(
    (x, y) => span(x) - span(y) || x.from.localeCompare(y.from) || x.name.localeCompare(y.name),
  );
  const kept: Plan[] = [];
  const folded: Fold[] = [];
  const extra = new Map<string, { ids: string[]; centroid?: { lat: number; lon: number } }>();
  for (const p of plans) {
    if (!CLUSTER_KINDS.includes(p.kind)) {
      kept.push(p);
      continue;
    }
    const days = new Set(p.ids.map((id) => day.get(id)).filter((d) => d !== undefined));
    let best: { e: FixedEvent; share: number } | null = null;
    for (const e of ordered) {
      const within = (d: string) => d >= e.from && d <= e.to;
      const share = p.ids.filter((id) => within(day.get(id) ?? "")).length / Math.max(1, p.ids.length);
      // Photo count alone would let a three week trip fold into the wedding weekend it starts with.
      const overDays = [...days].filter(within).length / Math.max(1, days.size);
      if (share >= k && overDays >= k && (!best || share > best.share)) best = { e, share };
    }
    if (!best) {
      kept.push(p);
      continue;
    }
    const key = `${best.e.name}:${best.e.from}`;
    const at = extra.get(key) ?? { ids: [] };
    if (events.has(key)) extra.set(key, { ids: [...at.ids, ...p.ids], centroid: at.centroid ?? p.centroid });
    folded.push({ event: best.e.name, plan: p });
  }
  // Rebuild rather than mutate: an outside caller keeps the plans it handed in.
  const merged = kept.map((p) => {
    const add = p.kind === "event" ? extra.get(p.key) : undefined;
    if (!add) return p;
    return { ...p, ids: [...new Set([...p.ids, ...add.ids])], centroid: p.centroid ?? add.centroid };
  });
  return { plans: merged, folded };
}

/** Full plan: every rule, sorted by start. */
export function plan(
  cfg: Config,
  assets: Asset[],
  opts: { now?: Date; windowDays?: number; scope?: Scope } = {},
): { plans: Plan[]; absorbed: Set<string>; folded: Fold[] } {
  const ctx = makeContext(cfg, opts.now, opts.windowDays, opts.scope);
  const all = [
    ...planTrips(ctx, assets),
    ...planGatherings(ctx, assets),
    ...planPersonYears(ctx, assets),
    ...planSeasons(ctx, assets),
    ...planFixedEvents(ctx, assets),
  ];
  const { plans, folded } = foldIntoEvents(ctx, assets, all);
  plans.sort((x, y) => x.start.getTime() - y.start.getTime());
  return { plans, absorbed: ctx.absorbed, folded };
}
