import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromToml } from "../src/config.js";
import { countAll, countAt, diffConfig, kindAt } from "../src/diff.js";
import type { Config } from "../src/types.js";

const base = fromToml(readFileSync(new URL("./fixtures/config.toml", import.meta.url), "utf8"));
const edit = (f: (c: Config) => void): Config => {
  const next = structuredClone(base);
  f(next);
  return next;
};

describe("config diff", () => {
  it("finds nothing in an untouched config", () => {
    const diff = diffConfig(base, structuredClone(base));
    expect(diff).toEqual({ changes: {}, gone: {} });
    expect(countAll(diff)).toBe(0);
  });

  it("reports a moved slider with the value it had", () => {
    const diff = diffConfig(base, edit((c) => (c.clustering.homeKm = 33)));
    expect(diff.changes["clustering.homeKm"]).toEqual({ kind: "changed", before: base.clustering.homeKm, after: 33 });
    expect(countAt(diff, "clustering")).toBe(1);
    expect(countAt(diff, "immich")).toBe(0);
  });

  it("marks the container of a changed field", () => {
    const diff = diffConfig(base, edit((c) => (c.homes[0].lat = 1)));
    expect(kindAt(diff, "homes[0].lat")).toBe("changed");
    expect(kindAt(diff, "homes[0]")).toBe("changed");
    expect(kindAt(diff, "homes")).toBe("changed");
    expect(kindAt(diff, "zones")).toBeUndefined();
  });

  it("counts an added home once, and does not touch the rows before it", () => {
    const diff = diffConfig(base, edit((c) => c.homes.push({ from: "2030-01-01", lat: 1, lon: 2 })));
    expect(kindAt(diff, `homes[${base.homes.length}]`)).toBe("added");
    expect(kindAt(diff, "homes[0]")).toBeUndefined();
    expect(countAt(diff, "homes")).toBe(1);
  });

  it("keeps the surviving rows quiet when a home in the middle goes", () => {
    const many = edit((c) => {
      c.homes = [
        { from: "2010-01-01", lat: 1, lon: 1 },
        { from: "2015-01-01", lat: 2, lon: 2 },
        { from: "2020-01-01", lat: 3, lon: 3 },
      ];
    });
    const diff = diffConfig(many, edit((c) => (c.homes = [many.homes[0], many.homes[2]])));
    expect(diff.changes).toEqual({});
    expect(diff.gone.homes).toEqual([{ key: "2015-01-01", before: many.homes[1] }]);
    expect(countAt(diff, "homes")).toBe(1);
  });

  it("reads an edited date as a change, not as a removal and an addition", () => {
    const diff = diffConfig(base, edit((c) => (c.homes[0].from = "2011-06-01")));
    expect(diff.changes["homes[0].from"]?.kind).toBe("changed");
    expect(diff.gone.homes).toBeUndefined();
  });

  it("treats a name list as a set", () => {
    const diff = diffConfig(
      base,
      edit((c) => (c.people.household = [...base.people.household, "New Guest"]))
    );
    const at = base.people.household.length;
    expect(diff.changes[`people.household[${at}]`]).toEqual({ kind: "added", after: "New Guest" });
    expect(diff.gone["people.household"]).toBeUndefined();
    expect(kindAt(diff, "people.household")).toBe("changed");

    const shorter = diffConfig(base, edit((c) => c.people.household.splice(0, 1)));
    expect(shorter.changes).toEqual({});
    expect(shorter.gone["people.household"]).toEqual([{ key: base.people.household[0], before: base.people.household[0] }]);
    expect(countAt(shorter, "people.household")).toBe(1);
  });

  it("separates a new alias from a dropped one", () => {
    const [first] = Object.keys(base.aliases);
    const diff = diffConfig(
      base,
      edit((c) => {
        delete c.aliases[first];
        c.aliases["Sion"] = "Valais";
      })
    );
    expect(diff.changes["aliases.Sion"]).toEqual({ kind: "added", after: "Valais" });
    expect(diff.gone.aliases).toEqual([{ key: first, before: base.aliases[first] }]);
  });

  it("follows a renamed zone through its circles instead of rebuilding it", () => {
    const zoned = edit((c) => {
      c.zones = [
        { name: "Massif", lat: 45, lon: 6, km: 12 },
        { name: "Massif", lat: 44.9, lon: 5.8, km: 12 },
      ];
    });
    const renamed = diffConfig(
      zoned,
      structuredClone({ ...zoned, zones: zoned.zones.map((z) => ({ ...z, name: "Vercors" })) })
    );
    expect(renamed.changes["zones[0].name"]?.kind).toBe("changed");
    expect(renamed.changes["zones[1].name"]?.kind).toBe("changed");
    expect(renamed.gone.zones).toBeUndefined();

    const dragged = diffConfig(zoned, { ...zoned, zones: [zoned.zones[0], { ...zoned.zones[1], lat: 44.95 }] });
    expect(Object.keys(dragged.changes)).toEqual(["zones[1].lat"]);
  });

  it("counts an event by its cells and drops a removed one into gone", () => {
    const withEvent = edit((c) => (c.events = [{ name: "Our wedding", from: "2019-08-30", to: "2019-09-01" }]));
    const changed = diffConfig(withEvent, edit((c) => (c.events = [{ name: "Our wedding", from: "2019-08-30", to: "2019-09-02" }])));
    expect(changed.changes["events[0].to"]?.kind).toBe("changed");
    const dropped = diffConfig(withEvent, edit((c) => (c.events = [])));
    expect(dropped.gone.events).toEqual([{ key: "Our wedding:2019-08-30", before: withEvent.events[0] }]);
  });

  it("calls a filled-in optional label an addition and a cleared one a removal", () => {
    const bare = edit((c) => delete c.homes[0].label);
    expect(diffConfig(bare, base).changes["homes[0].label"]?.kind).toBe("added");
    expect(diffConfig(base, bare).changes["homes[0].label"]).toEqual({ kind: "removed", before: base.homes[0].label });
  });

  it("adds up every section into the total", () => {
    const diff = diffConfig(
      base,
      edit((c) => {
        c.immich.marker = "[albums]";
        c.clustering.tripMinDays = 4;
        c.people.noPeoplePlaces.push("Home Village");
      })
    );
    expect(countAt(diff, "immich")).toBe(1);
    expect(countAt(diff, "clustering", "zones")).toBe(1);
    expect(countAll(diff)).toBe(3);
  });
});
