import type { Asset, Credential, ManagedAlbum } from "./types.js";
import { parseDescription } from "./reconcile.js";
import { haversineKm } from "./planner.js";

/** A hit from /search/places. `admin2name` is the district, a French departement. */
export interface PlaceHit {
  name: string;
  latitude: number;
  longitude: number;
  admin1name?: string;
  admin2name?: string;
}

/** Beyond this the place lookup matched a different town of the same name, so drop it. */
const DISTRICT_MAX_KM = 100;

/** Immich's place index skips the smallest communes; a known town this close shares their district. */
const NEIGHBOUR_KM = 25;

/** Prefers an exact name match, then the hit nearest the photo. */
function districtOf(hits: PlaceHit[], city: string, lat: number, lon: number): string | null {
  const exact = hits.filter((h) => h.name.toLowerCase() === city.toLowerCase());
  let best: { km: number; name: string } | null = null;
  for (const h of (exact.length ? exact : hits).filter((h) => h.admin2name)) {
    const km = haversineKm(lat, lon, h.latitude, h.longitude);
    if (!best || km < best.km) best = { km, name: h.admin2name! };
  }
  return best && best.km <= DISTRICT_MAX_KM ? best.name : null;
}

/** One asset per town, so the gap filling compares towns rather than photos. */
const byTown = (assets: Asset[]) => [...new Map(assets.map((a) => [a.city, a])).values()];

/** A town the place index does not carry takes the district of the nearest town that resolved. */
function fillFromNeighbours(assets: Asset[]) {
  const known = byTown(assets.filter((a) => a.district));
  if (!known.length) return;
  for (const town of byTown(assets.filter((a) => !a.district))) {
    let best: { km: number; district: string } | null = null;
    for (const k of known) {
      const km = haversineKm(town.lat!, town.lon!, k.lat!, k.lon!);
      if (!best || km < best.km) best = { km, district: k.district! };
    }
    if (!best || best.km > NEIGHBOUR_KM) continue;
    for (const a of assets) if (a.city === town.city) a.district = best.district;
  }
}

export class ImmichHttpError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} ${method} ${path}: ${body.slice(0, 300)}`);
  }
}

/** Users type the URL, so a trailing slash or a pasted /api suffix has to survive. */
export const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "").replace(/\/api$/, "");

export const authHeader = (cred: Credential | null): Record<string, string> =>
  !cred ? {} : cred.kind === "key" ? { "x-api-key": cred.value } : { Authorization: `Bearer ${cred.value}` };

/** One request against the Immich REST API. `cred` is omitted for the unauthenticated endpoints. */
export async function request<T = any>(
  baseUrl: string,
  method: string,
  path: string,
  opts: { cred?: Credential | null; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...authHeader(opts.cred ?? null), "Content-Type": "application/json", Accept: "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) throw new ImmichHttpError(res.status, method, path, await res.text());
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export class ImmichClient {
  constructor(private baseUrl: string, private cred: Credential) {}

  api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    return request<T>(this.baseUrl, method, path, { cred: this.cred, body });
  }

  /** `onPage` reports how many assets have been yielded and how many match in total. */
  async *search(body: Record<string, unknown>, onPage?: (done: number, total: number) => void): AsyncGenerator<any> {
    let done = 0;
    for (let page = 1; ; page++) {
      const res = await this.api("POST", "/search/metadata", { ...body, page, size: 1000 });
      const block = res?.assets ?? {};
      for (const item of block.items ?? []) {
        done++;
        yield item;
      }
      onPage?.(done, block.total ?? done);
      if (!block.nextPage) return;
    }
  }

  async checkAuth() {
    await this.api("GET", "/users/me");
  }

  /** Local capture time is kept as UTC so getUTC* accessors read local wall-clock values. */
  async fetchAssets(takenAfter?: Date, onProgress?: (done: number, total: number) => void): Promise<Map<string, Asset>> {
    const out = new Map<string, Asset>();
    const body = { withExif: true, visibility: "timeline", ...(takenAfter ? { takenAfter: takenAfter.toISOString() } : {}) };
    for await (const a of this.search(body, onProgress)) {
      const local: string | undefined = a.localDateTime ?? a.fileCreatedAt;
      if (!local) continue;
      const ex = a.exifInfo ?? {};
      out.set(a.id, {
        id: a.id,
        t: new Date(local.replace(/Z$|[+-]\d\d:\d\d$/, "") + "Z"),
        lat: ex.latitude ?? null,
        lon: ex.longitude ?? null,
        city: ex.city ?? null,
        state: ex.state ?? null,
        country: ex.country ?? null,
        people: new Set(),
      });
    }
    return out;
  }

  places(name: string): Promise<PlaceHit[]> {
    return this.api("GET", `/search/places?name=${encodeURIComponent(name)}`).then((r) => r ?? []);
  }

  /** Fills `district` for assets in `countries`, one place lookup per distinct city.
   * Mutates the assets and returns the cache. */
  async attachDistricts(
    assets: Map<string, Asset>,
    countries: string[],
    cache = new Map<string, PlaceHit[]>(),
    onProgress?: (done: number, total: number, city: string) => void,
  ): Promise<Map<string, PlaceHit[]>> {
    if (!countries.length) return cache;
    const want = [...assets.values()].filter(
      (a) => a.city && a.lat !== null && a.lon !== null && a.country && countries.includes(a.country),
    );
    const todo = [...new Set(want.map((a) => a.city!))].filter((c) => !cache.has(c));
    let done = 0;
    for (const city of todo) {
      cache.set(city, await this.places(city).catch(() => []));
      onProgress?.(++done, todo.length, city);
    }
    for (const a of want) {
      a.district = districtOf(cache.get(a.city!) ?? [], a.city!, a.lat!, a.lon!);
    }
    fillFromNeighbours(want);
    return cache;
  }

  async fetchPeople(): Promise<{ id: string; name: string }[]> {
    const people: { id: string; name: string }[] = [];
    for (let page = 1; ; page++) {
      const res = await this.api("GET", `/people?withHidden=false&page=${page}&size=500`);
      people.push(...(res.people ?? []).filter((p: any) => p.name));
      if (!res.hasNextPage) return people;
    }
  }

  /** One search per named person from `sinceYear`; mutates assets in place. Returns per-person counts. */
  async attachPeople(
    assets: Map<string, Asset>,
    people: { id: string; name: string }[],
    sinceYear: number,
    onPerson?: (done: number, total: number, name: string) => void,
  ) {
    const counts: Record<string, number> = {};
    const takenAfter = `${sinceYear}-01-01T00:00:00.000Z`;
    let done = 0;
    for (const p of people) {
      let n = 0;
      for await (const a of this.search({ personIds: [p.id], takenAfter, visibility: "timeline" })) {
        const asset = assets.get(a.id);
        if (asset) {
          asset.people.add(p.name);
          n++;
        }
      }
      counts[p.name] = n;
      onPerson?.(++done, people.length, p.name);
    }
    return counts;
  }

  /** The album response carries only a count, so the ids come from a search. */
  async albumAssetIds(id: string, count: number): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!count) return ids;
    for await (const a of this.search({ albumIds: [id] })) ids.add(a.id);
    return ids;
  }

  async fetchManagedAlbums(
    marker: string,
    onAlbum?: (done: number, total: number, name: string) => void,
  ): Promise<ManagedAlbum[]> {
    const albums: any[] = (await this.api("GET", "/albums")) ?? [];
    const mine = albums.filter((al) => parseDescription(marker, al.albumName, al.description));
    const out: ManagedAlbum[] = [];
    for (const al of mine) {
      const meta = parseDescription(marker, al.albumName, al.description)!;
      onAlbum?.(out.length + 1, mine.length, al.albumName);
      out.push({
        id: al.id,
        name: al.albumName,
        auto: meta.auto,
        kind: meta.kind,
        key: meta.key,
        assets: await this.albumAssetIds(al.id, al.assetCount ?? 0),
      });
    }
    return out;
  }

  createAlbum(name: string, description: string, assetIds: string[]) {
    return this.api("POST", "/albums", { albumName: name, description, assetIds });
  }
  updateAlbum(id: string, name: string, description: string) {
    return this.api("PATCH", `/albums/${id}`, { albumName: name, description });
  }
  addAssets(id: string, ids: string[]) {
    return this.api("PUT", `/albums/${id}/assets`, { ids });
  }
  removeAssets(id: string, ids: string[]) {
    return this.api("DELETE", `/albums/${id}/assets`, { ids });
  }
}
