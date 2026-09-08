import type { Asset, Credential, ManagedAlbum } from "./types.js";
import { parseDescription } from "./reconcile.js";

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
