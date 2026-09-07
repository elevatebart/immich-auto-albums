import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromToml } from "../src/config.js";
import { plan, planFixedEvents, planTrips, makeContext, taggedSince, yearsCovered } from "../src/planner.js";
import { descriptionFor, parseDescription, reconcile } from "../src/reconcile.js";
import type { Asset, ManagedAlbum } from "../src/types.js";

const cfg = fromToml(readFileSync(new URL("./fixtures/config.toml", import.meta.url), "utf8"));
const NOW = new Date("2026-09-04T12:00:00Z");
const H = 3_600_000;

let seq = 0;
const mk = (t: Date, lat: number | null, lon: number | null, city: string | null, state: string | null = null, country: string | null = "France", people: string[] = []): Asset => ({
  id: `a${seq++}`, t, lat, lon, city, state, country, people: new Set(people),
});
const burst = (start: Date, n: number, stepH: number, f: (t: Date, i: number) => Asset) =>
  Array.from({ length: n }, (_, i) => f(new Date(start.getTime() + i * stepH * H), i));

describe("rule engines", () => {
  it("names a trip, folds GPS-less photos in, names guests from face-tagged share", () => {
    const b = new Date("2026-08-10T10:00:00Z");
    const A = [
      ...burst(b, 12, 6, (t, i) => mk(t, 45.9, 6.13, "Annecy", "AURA", "France", i < 8 ? ["Theo Rivers", "Alice Martin"] : ["Theo Rivers"])),
      ...burst(b, 20, 3, (t) => mk(t, null, null, null)),
    ];
    const { plans, absorbed } = plan(cfg, A, { now: NOW });
    const trip = plans.find((p) => p.kind === "trip")!;
    expect(trip.name).toBe("Annecy with Alice, Aug 2026");
    expect(trip.ids).toHaveLength(32);
    expect(absorbed.size).toBe(20);
  });

  it("day trip, gathering, household min photos, season bucket", () => {
    const A = [
      ...burst(new Date("2026-07-04T09:00:00Z"), 16, 1 / 3, (t) => mk(t, 45.76, 4.84, "Lyon")),
      ...burst(new Date("2026-06-21T18:00:00Z"), 32, 1 / 12, (t) => mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Alice Martin", "Bob Roy", "Cara Li"])),
      ...burst(new Date("2026-05-01T00:00:00Z"), 5, 24, (t) => mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Nadia Rivers"])),
      ...burst(new Date("2004-07-15T00:00:00Z"), 6, 24, (t) => mk(t, null, null, null)),
    ];
    const names = plan(cfg, A, { now: NOW }).plans.map((p) => `${p.kind}|${p.name}|${p.ids.length}`);
    expect(names).toContain("daytrip|Lyon, 04 Jul 2026|16");
    expect(names).toContain("gathering|Gathering at home, 21 Jun 2026|32");
    expect(names).toContain("season|Summer 2004|6");
    expect(names.some((n) => n.startsWith("person|Nadia 2026"))).toBe(false); // 5 < household min 10
  });

  it("place hierarchy: village merge, state, country, two countries, no-people places", () => {
    const ctx = makeContext(cfg, NOW, 9000);
    const trip = (off: number, spots: [number, number, string, string, string, number, string[]][]) => {
      const b = new Date(Date.UTC(2025, 0, 1 + off));
      let n = 0;
      return spots.flatMap(([lat, lon, city, state, country, count, people]) =>
        Array.from({ length: count }, () => mk(new Date(b.getTime() + n++ * 6 * H), lat, lon, city, state, country, people)));
    };
    const A = [
      ...trip(0, [[46.28, 6.16, "Versoix", "Genève", "Switzerland", 8, ["Antoine Fontaine"]], [46.31, 6.19, "Coppet", "Vaud", "Switzerland", 6, ["Antoine Fontaine"]]]),
      ...trip(30, [[45.05, 5.28, "Saint-Thomas-en-Royans", "AURA", "France", 10, []], [45.06, 5.31, "Sainte-Eulalie-en-Royans", "AURA", "France", 6, []]]),
      ...trip(60, [[41.88, -87.63, "Chicago", "Illinois", "USA", 8, []], [42.05, -88.08, "Schaumburg", "Illinois", "USA", 6, []], [41.5, -90.5, "Moline", "Illinois", "USA", 5, []]]),
      ...trip(90, [[29.76, -95.37, "Houston", "Texas", "USA", 8, []], [27.77, -82.64, "St. Petersburg", "Florida", "USA", 7, []]]),
      ...trip(120, [[48.85, 2.35, "Paris 09 Opéra", "IdF", "France", 8, []], [51.5, -0.12, "City of Westminster", "England", "UK", 7, []]]),
    ];
    expect(planTrips(ctx, A).map((p) => p.name)).toEqual([
      "Versoix, Jan 2025",
      "Saint-Thomas-en-Royans, Jan-Feb 2025",
      "Illinois, Mar 2025",
      "USA, Apr 2025",
      "France & UK, May 2025",
    ]);
  });

  it("window scope plans only what the window covers in full", () => {
    const A = [
      // Inside a 365 day window: a day trip and photos of a household member this year.
      ...burst(new Date("2026-07-04T09:00:00Z"), 16, 1 / 3, (t) => mk(t, 45.76, 4.84, "Lyon")),
      ...burst(new Date("2026-02-01T00:00:00Z"), 12, 24 * 7, (t) => mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Nadia Rivers"])),
      // Outside it: a 2004 season bucket and the 2019 wedding.
      ...burst(new Date("2004-07-15T00:00:00Z"), 6, 24, (t) => mk(t, null, null, null)),
      ...burst(new Date("2019-08-30T00:00:00Z"), 11, 7, (t) => mk(t, null, null, null)),
    ];
    const kinds = (scope: "window" | "all") =>
      plan(cfg, A, { now: NOW, windowDays: 9000, scope }).plans.map((p) => `${p.kind}|${p.name}`);
    expect(kinds("all")).toEqual(
      expect.arrayContaining(["season|Summer 2004", "event|Our wedding, Aug 2019", "daytrip|Lyon, 04 Jul 2026"]),
    );
    // Same assets, a 365 day window: history is left alone, this year is not.
    const windowed = plan(cfg, A, { now: NOW, scope: "window" }).plans.map((p) => `${p.kind}|${p.name}`);
    expect(windowed).toEqual(["person|Nadia 2026", "daytrip|Lyon, 04 Jul 2026"]);
  });

  it("all scope reaches past the window for trips and person years too", () => {
    const old = new Date("2019-06-01T09:00:00Z");
    const A = [
      ...burst(old, 14, 6, (t) => mk(t, 45.9, 6.13, "Annecy", "AURA", "France", ["Alice Martin"])),
      ...burst(new Date("2019-03-01T00:00:00Z"), 60, 24 * 4, (t) => mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Alice Martin"])),
    ];
    const names = (scope: "window" | "all") =>
      plan(cfg, A, { now: NOW, scope }).plans.map((p) => `${p.kind}|${p.name}`);
    // A 365 day window ends in 2025, so nothing here is planned.
    expect(names("window")).toEqual([]);
    // The Grenoble burst runs into the fixture's wedding range, so that event lands too.
    expect(names("all")).toEqual([
      "person|Alice 2019",
      "trip|Annecy with Alice, Jun 2019",
      "event|Our wedding, Aug 2019",
    ]);
  });

  it("fetches face tags further back than it plans person years", () => {
    const ctx = makeContext(cfg, NOW, 365, "window");
    // Only 2026 is inside the window in full, but London in Sep 2025 still needs its faces.
    expect(yearsCovered(ctx)).toEqual([2026]);
    expect(taggedSince(ctx)).toBe(2025);
  });

  it("names a trip after the region holding most of it", () => {
    const ctx = makeContext(cfg, NOW, 9000);
    const b = new Date(Date.UTC(2025, 5, 1));
    const A = [
      // 18 photos across two towns of one region, no town dominant enough to name it.
      ...burst(b, 10, 6, (t) => mk(t, 45.05, 5.28, "Saint-Nazaire-en-Royans", "Auvergne-Rhône-Alpes", "France")),
      ...burst(new Date(b.getTime() + 80 * H), 8, 6, (t) => mk(t, 45.9, 6.13, "Annecy", "Auvergne-Rhône-Alpes", "France")),
      // 3 photos over the border on the way home: 86% of the trip is still AURA.
      ...burst(new Date(b.getTime() + 140 * H), 3, 6, (t) => mk(t, 46.2, 6.14, "Genève", "Genève", "Switzerland")),
    ];
    expect(planTrips(ctx, A).map((p) => p.name)).toEqual(["Auvergne-Rhône-Alpes, Jun 2025"]);

    // Drop the region share below the split and the old country pair comes back.
    const loose = { ...cfg, clustering: { ...cfg.clustering, regionShare: 0.95 } };
    expect(planTrips(makeContext(loose, NOW, 9000), A).map((p) => p.name)).toEqual([
      "France & Switzerland, Jun 2025",
    ]);
  });

  it("fixed events, and a country name when no city is known", () => {
    const ctx = makeContext(cfg, NOW, 9000);
    const A = burst(new Date("2019-08-30T00:00:00Z"), 12, 7, (t) => mk(t, null, null, null));
    expect(planFixedEvents(ctx, A).map((p) => [p.name, p.ids.length])).toEqual([["Our wedding, Aug 2019", 11]]);

    const B = burst(new Date("2020-08-05T00:00:00Z"), 66, 4, (t) => mk(t, 44.0, -86.5, null, null, "United States of America"));
    const { plans } = plan(cfg, B, { now: NOW, windowDays: 9000 });
    expect(plans.find((p) => p.kind === "trip")!.name).toBe("United States of America, Aug 2020");
  });
});

describe("reconcile", () => {
  it("round trips a key that holds a name with spaces", () => {
    const marker = cfg.immich.marker;
    for (const [kind, key] of [
      ["person", "Nadia Rivers:2026"],
      ["event", "Our wedding:2019-08-30"],
      ["season", "Summer:2004"],
      ["trip", "2026-08-08"],
    ] as const) {
      const desc = descriptionFor(marker, { kind, key, name: "Album", ids: [], start: NOW });
      expect(parseDescription(marker, "Album", desc)).toEqual({ kind, key, auto: "Album" });
    }
    expect(parseDescription(marker, "Album", "someone else's album")).toBeNull();
  });

  it("matches a person album by its key rather than recreating it", () => {
    const A = burst(new Date("2026-02-01T00:00:00Z"), 12, 24 * 7, (t) =>
      mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Nadia Rivers"]),
    );
    const { plans } = plan(cfg, A, { now: NOW });
    const person = plans.find((p) => p.kind === "person")!;
    const desc = descriptionFor(cfg.immich.marker, person);
    const meta = parseDescription(cfg.immich.marker, person.name, desc)!;
    const album: ManagedAlbum = {
      id: "p1",
      name: person.name,
      auto: meta.auto,
      kind: meta.kind,
      key: meta.key,
      assets: new Set(person.ids),
    };
    expect(reconcile([person], [album])[0].op).toBe("noop");
  });

  it("keeps a user rename, renames its own, matches by overlap", () => {
    const b = new Date("2026-08-10T10:00:00Z");
    const A = burst(b, 12, 6, (t) => mk(t, 45.9, 6.13, "Annecy"));
    const { plans } = plan(cfg, A, { now: NOW });
    const trip = plans.find((p) => p.kind === "trip")!;
    const mine: ManagedAlbum = { id: "x", name: "Annecy, Aug 2026 (old)", auto: "Annecy, Aug 2026 (old)", kind: "trip", key: "2026-08-10", assets: new Set(trip.ids.slice(0, 8)) };
    const yours: ManagedAlbum = { ...mine, id: "y", name: "Lake week", auto: "Annecy, Aug 2026 (old)" };
    const a1 = reconcile([trip], [mine])[0];
    expect(a1.op === "update" && a1.rename && !a1.userRenamed && a1.add.length === 4).toBe(true);
    const a2 = reconcile([trip], [yours])[0];
    expect(a2.op === "update" && !a2.rename && a2.userRenamed).toBe(true);

    // Same photos, a stale generated name: a rename, not an update.
    const named: ManagedAlbum = { ...mine, id: "z", assets: new Set(trip.ids) };
    const a3 = reconcile([trip], [named])[0];
    expect([a3.op, a3.op !== "noop" && a3.rename]).toEqual(["rename", true]);

    // Same photos, same name: nothing to do.
    const same: ManagedAlbum = { ...named, id: "w", name: trip.name, auto: trip.name };
    expect(reconcile([trip], [same])[0].op).toBe("noop");
  });
});
