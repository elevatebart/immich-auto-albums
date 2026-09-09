import type { Config } from "./types.js";

export type ChangeKind = "changed" | "added" | "removed";

export interface Change {
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
}

/** An item the baseline has and the config no longer does, so no form row carries it. */
export interface Gone {
  /** Identity of the item: an alias key, a home date, a list entry. */
  key: string;
  before: unknown;
}

export interface ConfigDiff {
  /** Form field paths to their change: `clustering.homeKm`, `homes[2].lat`, `aliases.London`. */
  changes: Record<string, Change>;
  /** Removals, keyed by the collection path they left. */
  gone: Record<string, Gone[]>;
}

export const EMPTY_DIFF: ConfigDiff = { changes: {}, gone: {} };

/** The one free-form record in Config, so a dropped key is a removal and not an emptied field. */
const RECORDS = new Set(["aliases"]);

type Item = Record<string, unknown>;

/** Identity of an array item, so an edit reads as a change and not as a removal plus an addition. */
const IDENTITY: Record<string, (item: Item, at: number, all: Item[]) => string> = {
  homes: (h) => String(h.from),
  events: (e) => `${String(e.name)}:${String(e.from)}`,
  // Circles sharing a name are one zone, so a circle is identified by its rank inside that name.
  zones: (z, at, all) => `${String(z.name)}#${all.slice(0, at).filter((o) => o.name === z.name).length}`,
};

const isRec = (v: unknown): v is Item => !!v && typeof v === "object" && !Array.isArray(v);

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (isRec(a) && isRec(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => equal(a[k], b[k]));
  }
  return false;
}

/** Pairs up array items by identity first, then by position among what is left over. */
function align(base: Item[], next: Item[], identity: (i: Item, at: number, all: Item[]) => string) {
  const keys = base.map((item, at) => identity(item, at, base));
  const taken = new Set<number>();
  const pairs = new Map<number, number>();
  next.forEach((item, at) => {
    const key = identity(item, at, next);
    const found = keys.findIndex((k, j) => k === key && !taken.has(j));
    if (found >= 0) {
      taken.add(found);
      pairs.set(at, found);
    }
  });
  const spare = base.map((_, j) => j).filter((j) => !taken.has(j));
  next.forEach((_, at) => {
    if (pairs.has(at)) return;
    const j = spare.shift();
    if (j === undefined) return;
    taken.add(j);
    pairs.set(at, j);
  });
  return { pairs, removed: spare };
}

function walkList(path: string, base: unknown[], next: unknown[], out: ConfigDiff) {
  const objects = [...base, ...next].some(isRec);
  if (!objects) {
    // Order carries no meaning in a name list, so entries are compared as a set.
    const had = new Set(base.map(String));
    next.forEach((v, at) => {
      if (!had.has(String(v))) out.changes[`${path}[${at}]`] = { kind: "added", after: v };
    });
    const kept = new Set(next.map(String));
    const gone = base.filter((v) => !kept.has(String(v))).map((v) => ({ key: String(v), before: v }));
    if (gone.length) out.gone[path] = gone;
    return;
  }
  const identity = IDENTITY[path] ?? ((_: Item, at: number) => String(at));
  const { pairs, removed } = align(base as Item[], next as Item[], identity);
  next.forEach((item, at) => {
    const from = pairs.get(at);
    if (from === undefined) out.changes[`${path}[${at}]`] = { kind: "added", after: item };
    else walk(`${path}[${at}]`, base[from], item, out);
  });
  const gone = removed.map((j) => ({ key: identity(base[j] as Item, j, base as Item[]), before: base[j] }));
  if (gone.length) out.gone[path] = gone;
}

function walkRec(path: string, base: Item, next: Item, out: ConfigDiff) {
  for (const key of Object.keys(next)) walk(join(path, key), base[key], next[key], out);
  const dropped = Object.keys(base).filter((k) => !(k in next) && base[k] !== undefined);
  if (!dropped.length) return;
  if (RECORDS.has(path)) {
    out.gone[path] = dropped.map((k) => ({ key: k, before: base[k] }));
    return;
  }
  for (const key of dropped) out.changes[join(path, key)] = { kind: "removed", before: base[key] };
}

function walk(path: string, base: unknown, next: unknown, out: ConfigDiff) {
  if (equal(base, next)) return;
  if (Array.isArray(base) && Array.isArray(next)) return walkList(path, base, next, out);
  if (isRec(base) && isRec(next)) return walkRec(path, base, next, out);
  const kind = base === undefined || base === "" ? "added" : next === undefined ? "removed" : "changed";
  out.changes[path] = { kind, before: base, after: next };
}

/** What the config on screen changes about a baseline: the saved file, or the example. */
export function diffConfig(base: Config, next: Config): ConfigDiff {
  const out: ConfigDiff = { changes: {}, gone: {} };
  walkRec("", base as unknown as Item, next as unknown as Item, out);
  return out;
}

const under = (path: string, prefix: string) =>
  !prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);

const within = (path: string, prefix: string) => path === prefix || under(path, prefix);

/** The change on a field, or on the container of anything changed below it. */
export function kindAt(diff: ConfigDiff, path: string): ChangeKind | undefined {
  const own = diff.changes[path];
  if (own) return own.kind;
  if (Object.keys(diff.changes).some((p) => under(p, path))) return "changed";
  if (Object.keys(diff.gone).some((p) => within(p, path) && diff.gone[p].length)) return "changed";
  return undefined;
}

/** Changes at or under the given paths, counting the deepest entry only so a row counts once. */
export function countAt(diff: ConfigDiff, ...prefixes: string[]): number {
  const hit = (p: string) => prefixes.some((prefix) => within(p, prefix));
  const paths = Object.keys(diff.changes).filter(hit);
  const leaves = paths.filter((p) => !paths.some((q) => q !== p && under(q, p)));
  const gone = Object.keys(diff.gone)
    .filter(hit)
    .reduce((n, p) => n + diff.gone[p].length, 0);
  return leaves.length + gone;
}

export const countAll = (diff: ConfigDiff) => countAt(diff, "");
