import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromToml } from "../src/config.js";
import { foldIntoEvents, plan, planFixedEvents, planTrips, makeContext, taggedSince, yearsCovered } from "../src/planner.js";
import { descriptionFor, orphans, parseDescription, reconcile } from "../src/reconcile.js";
import type { Asset, ManagedAlbum } from "../src/types.js";

const cfg = fromToml(readFileSync(new URL("./fixtures/config.toml", import.meta.url), "utf8"));
const NOW = new Date("2026-09-04T12:00:00Z");
const H = 3_600_000;

let seq = 0;
const mk = (t: Date, lat: number | null, lon: number | null, city: string | null, state: string | null = null, country: string | null = "France", people: string[] = [], district: string | null = null): Asset => ({
  id: `a${seq++}`, t, lat, lon, city, state, district, country, people: new Set(people),
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

  it("place hierarchy: village merge, state, two states, two countries, no-people places", () => {
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
      ...trip(60, [[41.88, -87.63, "Chicago", "Illinois", "United States of America", 8, []], [42.05, -88.08, "Schaumburg", "Illinois", "United States of America", 6, []], [41.5, -90.5, "Moline", "Illinois", "United States of America", 5, []]]),
      ...trip(90, [[29.76, -95.37, "Houston", "Texas", "United States of America", 8, []], [27.77, -82.64, "St. Petersburg", "Florida", "United States of America", 7, []]]),
      // Three states, so no pair carries the trip: the country names it, through its alias.
      ...trip(120, [[29.76, -95.37, "Houston", "Texas", "United States of America", 6, []], [27.77, -82.64, "St. Petersburg", "Florida", "United States of America", 5, []], [34.05, -118.24, "Los Angeles", "California", "United States of America", 5, []]]),
      ...trip(150, [[48.85, 2.35, "Paris 09 Opéra", "IdF", "France", 8, []], [51.5, -0.12, "City of Westminster", "England", "UK", 7, []]]),
      // A road trip through four states: no region carries it, so the leading city names it.
      ...trip(180, [[29.95, -90.07, "New Orleans", "Louisiana", "United States of America", 13, []], [37.46, -89.24, "Anna", "Illinois", "United States of America", 5, []], [43.47, -89.74, "Baraboo", "Wisconsin", "United States of America", 4, []], [35.15, -90.05, "Memphis", "Tennessee", "United States of America", 3, []]]),
    ];
    expect(planTrips(ctx, A).map((p) => p.name)).toEqual([
      "Versoix, Jan 2025",
      "Saint-Thomas-en-Royans, Jan-Feb 2025",
      "Illinois, Mar 2025",
      // Two states of one country: both are named, since "USA" says nothing about where.
      "Texas & Florida, Apr 2025",
      "USA, May 2025",
      // Two countries: the pair stays at country level rather than naming their regions.
      "France & UK, May-Jun 2025",
      "New Orleans, Jun-Jul 2025",
    ]);
  });

  it("a spread out trip groups places coarsely, a tight one does not", () => {
    const ctx = makeContext(cfg, NOW, 9000);
    const spots = (off: number, xs: [number, number, string, string, number][]) => {
      const b = new Date(Date.UTC(2025, 0, 1 + off));
      let n = 0;
      return xs.flatMap(([lat, lon, city, state, count]) =>
        Array.from({ length: count }, () => mk(new Date(b.getTime() + n++ * 6 * H), lat, lon, city, state, "Japan")));
    };
    // 370 km between the legs lifts the radius to its cap, so two Tokyo spots 18 km apart are one place.
    const wide = spots(0, [[35.69, 139.7, "Tokyo", "Kanto", 10], [35.63, 139.88, "Tokyo", "Kanto", 8], [35.01, 135.77, "Kyoto", "Kansai", 6]]);
    // The same two spots on their own stay 18 km apart, past both the base radius and the label merge.
    const tight = spots(30, [[35.69, 139.7, "Tokyo", "Kanto", 10], [35.63, 139.88, "Chiba", "Kanto", 8]]);
    expect(planTrips(ctx, [...wide, ...tight]).map((p) => p.name)).toEqual(["Tokyo, Jan 2025", "Kanto, Jan-Feb 2025"]);
    const off = { ...cfg, clustering: { ...cfg.clustering, placeKmMax: cfg.clustering.placeKm } };
    // No place dominates without the merge, so the two regions name it instead of the country.
    expect(planTrips(makeContext(off, NOW, 9000), wide).map((p) => p.name)).toEqual(["Kanto & Kansai, Jan 2025"]);
  });

  it("a French departement names the trip, unless the region is one to keep", () => {
    const ctx = makeContext(cfg, NOW, 9000);
    const trip = (off: number, spots: [number, number, string, string, string | null, number][]) => {
      const b = new Date(Date.UTC(2025, 0, 1 + off));
      let n = 0;
      return spots.flatMap(([lat, lon, city, state, district, count]) =>
        Array.from({ length: count }, () => mk(new Date(b.getTime() + n++ * 6 * H), lat, lon, city, state, "France", [], district)));
    };
    const A = [
      // Two departements of one region: the region is dropped, both departements are named.
      ...trip(0, [[45.52, 4.87, "Vienne", "Rhône-Alpes", "Isère", 10], [44.93, 4.89, "Valence", "Rhône-Alpes", "Drôme", 8]]),
      // Three of them: no pair carries the trip, so the region comes back.
      ...trip(30, [[45.52, 4.87, "Vienne", "Rhône-Alpes", "Isère", 8], [44.93, 4.89, "Valence", "Rhône-Alpes", "Drôme", 6], [45.57, 5.92, "Chambéry", "Rhône-Alpes", "Savoie", 6]]),
      // Kept regions name the trip themselves, and an alias renames one of them.
      ...trip(60, [[49.05, -1.45, "Coutances", "Normandy", "Manche", 10], [49.28, -0.7, "Bayeux", "Normandy", "Calvados", 8]]),
      ...trip(90, [[48.85, 2.35, "Paris 09 Opéra", "Île-de-France", "Paris", 10], [48.4, 2.7, "Fontainebleau", "Île-de-France", "Seine-et-Marne", 8]]),
      // Villages of two departements: two circles of one zone hold them, and it names the trip.
      ...trip(150, [[45.05, 6.03, "Le Bourg-d'Oisans", "Rhône-Alpes", "Isère", 8], [44.9, 5.79, "La Mure", "Rhône-Alpes", "Isère", 6], [45.42, 5.87, "Saint-Pierre-d'Entremont", "Rhône-Alpes", "Savoie", 5]]),
      // No district known, as for a country Immich has no admin2 for: the region still names it.
      ...trip(120, [[41.88, -87.63, "Chicago", "Illinois", null, 8], [42.05, -88.08, "Schaumburg", "Illinois", null, 6], [41.5, -90.5, "Moline", "Illinois", null, 5]]),
    ];
    expect(planTrips(ctx, A).map((p) => p.name)).toEqual([
      "Isère & Drôme, Jan 2025",
      "Rhône-Alpes, Jan-Feb 2025",
      "Normandy, Mar 2025",
      "Paris, Apr 2025",
      "Illinois, May 2025",
      "Mountains around Grenoble, May-Jun 2025",
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

  it("favorites limit person years to the picked people", () => {
    const A = [
      ...burst(new Date("2026-02-01T00:00:00Z"), 12, 24, (t) => mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Nadia Rivers", "Alice Martin"])),
      ...burst(new Date("2026-03-01T00:00:00Z"), 60, 24, (t) => mk(t, 45.19, 5.72, "Grenoble", null, "France", ["Alice Martin"])),
    ];
    const persons = (c: typeof cfg) =>
      plan(c, A, { now: NOW }).plans.filter((p) => p.kind === "person").map((p) => p.name);
    expect(persons(cfg)).toEqual(["Nadia 2026", "Alice 2026"]);
    const only = { ...cfg, personYears: { ...cfg.personYears, favorites: ["Nadia Rivers"] } };
    expect(persons(only)).toEqual(["Nadia 2026"]);
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

  it("a cluster inside a hand-declared event folds into it instead of getting its own album", () => {
    // The wedding weekend, shot in Saint-Jean-en-Royans, plus a few phone photos with no GPS.
    const A = [
      ...burst(new Date("2019-08-30T09:00:00Z"), 24, 2, (t) => mk(t, 45.01, 5.29, "Saint-Jean-en-Royans", "Auvergne-Rhône-Alpes")),
      ...burst(new Date("2019-08-31T12:00:00Z"), 6, 1, (t) => mk(t, null, null, null)),
    ];
    const { plans, folded } = plan(cfg, A, { now: NOW, windowDays: 9000, scope: "all" });
    expect(plans.map((p) => `${p.kind}|${p.name}|${p.ids.length}`)).toEqual(["event|Our wedding, Aug 2019|30"]);
    expect(folded.map((f) => [f.event, f.plan.kind])).toEqual([["Our wedding", "trip"]]);
    // The trip's centroid rides along so the event row still draws a map.
    expect(plans[0].centroid).toBeDefined();
  });

  it("the event takes the whole cluster, including the days either side of its range", () => {
    const A = burst(new Date("2019-08-29T09:00:00Z"), 30, 3, (t) => mk(t, 45.01, 5.29, "Saint-Jean-en-Royans"));
    const ctx = makeContext(cfg, NOW, 9000);
    // On its own the range holds fewer: the arrival and the drive home fall outside it.
    expect(planFixedEvents(ctx, A)[0].ids).toHaveLength(24);
    const { plans } = plan(cfg, A, { now: NOW, windowDays: 9000, scope: "all" });
    expect(plans.map((p) => `${p.kind}|${p.ids.length}`)).toEqual(["event|30"]);
  });

  it("a trip only clipping the range keeps its own album", () => {
    const A = burst(new Date("2019-09-01T09:00:00Z"), 40, 6, (t) => mk(t, 45.9, 6.13, "Annecy", "AURA"));
    const kinds = plan(cfg, A, { now: NOW, windowDays: 9000, scope: "all" }).plans.map((p) => p.kind);
    expect(kinds).toEqual(["event", "trip"]);
  });

  it("window scope drops the cluster too, so a full run's event album is left alone", () => {
    const A = burst(new Date("2019-08-30T09:00:00Z"), 40, 2, (t) => mk(t, 45.01, 5.29, "Saint-Jean-en-Royans"));
    // A window starting mid-event: trips see the tail of it, the event itself is not covered.
    const { plans, folded } = plan(cfg, A, { now: NOW, windowDays: 2561, scope: "window" });
    expect(plans).toEqual([]);
    expect(folded.map((f) => f.event)).toEqual(["Our wedding"]);
  });

  it("a photo-heavy weekend does not drag three weeks of honeymoon into the event", () => {
    const A = [
      // 40 photos over the wedding weekend, then a fortnight of one a day, all one cluster.
      ...burst(new Date("2019-08-30T09:00:00Z"), 40, 1.5, (t) => mk(t, 45.01, 5.29, "Saint-Jean-en-Royans")),
      ...burst(new Date("2019-09-02T12:00:00Z"), 15, 24, (t) => mk(t, 43.7, 7.26, "Nice")),
    ];
    // Three quarters of the photos are inside the range, but only three of eighteen days are.
    const kinds = plan(cfg, A, { now: NOW, windowDays: 9000, scope: "all" }).plans.map((p) => p.kind);
    expect(kinds).toEqual(["event", "trip"]);
  });

  it("two events over one cluster: the larger share wins", () => {
    const A = burst(new Date("2018-08-24T09:00:00Z"), 20, 3, (t) => mk(t, 45.01, 5.29, "Saint-Jean-en-Royans"));
    const two = {
      ...cfg,
      events: [
        { name: "Engagement celebration", from: "2018-08-23", to: "2018-08-26" },
        { name: "A day of it", from: "2018-08-24", to: "2018-08-24" },
      ],
    };
    const trips = planTrips(makeContext(two, NOW, 9000), A);
    const { folded } = foldIntoEvents(makeContext(two, NOW, 9000), A, trips);
    expect(folded.map((f) => f.event)).toEqual(["Engagement celebration"]);
    // With no event declared the trip survives untouched.
    const none = makeContext({ ...cfg, events: [] }, NOW, 9000);
    expect(foldIntoEvents(none, A, planTrips(none, A)).folded).toEqual([]);
  });

  it("fixed events, and a country name when no city is known", () => {
    const ctx = makeContext(cfg, NOW, 9000);
    const A = burst(new Date("2019-08-30T00:00:00Z"), 12, 7, (t) => mk(t, null, null, null));
    expect(planFixedEvents(ctx, A).map((p) => [p.name, p.ids.length])).toEqual([["Our wedding, Aug 2019", 11]]);

    const B = burst(new Date("2020-08-05T00:00:00Z"), 66, 4, (t) => mk(t, 44.0, -86.5, null, null, "United States of America"));
    const { plans } = plan(cfg, B, { now: NOW, windowDays: 9000 });
    // No city and no state: only the country is left, and the alias shortens it.
    expect(plans.find((p) => p.kind === "trip")!.name).toBe("USA, Aug 2020");
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

  it("reports managed albums no plan claims any more", () => {
    const p = { kind: "trip" as const, key: "2019-08-30", name: "Saint-Jean-en-Royans, Aug 2019", ids: ["a", "b"], start: new Date("2019-08-30") };
    const mine: ManagedAlbum = { id: "x", name: p.name, auto: p.name, kind: "trip", key: p.key, assets: new Set(["a", "b"]) };
    const gone: ManagedAlbum = { ...mine, id: "y", key: "2015-01-01", assets: new Set(["z"]) };
    const actions = reconcile([p], [mine, gone]);
    expect(orphans(actions, [mine, gone]).map((al) => al.id)).toEqual(["y"]);
    // A window run never looked at 2015, so it is not news that nothing claimed it.
    expect(orphans(actions, [mine, gone], "2019-01-01")).toEqual([]);
  });
});
