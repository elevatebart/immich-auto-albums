import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromToml } from "../src/config.js";
import { configSchema, schemaField } from "../src/schema.js";
import { validateConfig } from "../src/validate.js";
import type { Config } from "../src/types.js";

const cfg = fromToml(readFileSync(new URL("./fixtures/config.toml", import.meta.url), "utf8"));
const clone = () => structuredClone(cfg) as Config;
const fields = (raw: unknown) => validateConfig(raw).issues.map((i) => i.field);

describe("configSchema", () => {
  it("accepts the test config", () => {
    expect(validateConfig(cfg).issues).toEqual([]);
  });

  it("accepts config.example.toml, the file users start from", () => {
    const example = fromToml(readFileSync(new URL("../config.example.toml", import.meta.url), "utf8"));
    expect(validateConfig(example).issues).toEqual([]);
  });

  it("matches the generated config.schema.json", () => {
    const onDisk = JSON.parse(readFileSync(new URL("../config.schema.json", import.meta.url), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(configSchema)));
  });

  it("fills defaults for the optional collections", () => {
    const bare = clone() as Record<string, unknown>;
    delete bare.aliases;
    delete bare.events;
    const { config, issues } = validateConfig(bare);
    expect(issues).toEqual([]);
    expect([config.aliases, config.events]).toEqual([{}, []]);
  });

  it("reports schema and ordering problems in one pass", () => {
    const bad = clone() as any;
    bad.clustering.homeKm = "twenty";
    bad.clustering.tripMinDays = 0;
    bad.people.maxNamed = 99;
    bad.homes[0].lat = 100;
    bad.seasons.noGpsEraEnd = "2012-02-30";
    bad.homes.reverse();
    bad.events[0].to = "2019-08-01";
    expect(fields(bad)).toEqual([
      "people.maxNamed",
      "homes[4].lat",
      "clustering.homeKm",
      "clustering.tripMinDays",
      "seasons.noGpsEraEnd",
      "homes[1].from",
      "homes[2].from",
      "homes[3].from",
      "homes[4].from",
      "events[0].to",
    ]);
  });

  it.each([
    ["a missing section", (c: any) => delete c.clustering, "clustering"],
    ["a missing key", (c: any) => delete c.immich.marker, "immich.marker"],
    ["an empty string", (c: any) => (c.people.me = ""), "people.me"],
    ["no homes", (c: any) => (c.homes = []), "homes"],
    ["an unknown key", (c: any) => (c.clustering.homeMiles = 12), "clustering.homeMiles"],
    ["a malformed date", (c: any) => (c.events[0].from = "30-08-2019"), "events[0].from"],
    ["homes out of order", (c: any) => c.homes.reverse(), "homes[1].from"],
    ["an event ending before it starts", (c: any) => (c.events[0].to = "2019-08-01"), "events[0].to"],
  ])("rejects %s", (_name, mutate, field) => {
    const bad = clone();
    mutate(bad);
    expect(fields(bad)).toContain(field);
  });
});

describe("fromToml", () => {
  it("throws with the offending field", () => {
    const text = readFileSync(new URL("./fixtures/config.toml", import.meta.url), "utf8").replace(
      "home_km = 20",
      "home_km = 900",
    );
    expect(() => fromToml(text)).toThrow(/clustering.homeKm must be <= 500/);
  });
});

describe("schemaField", () => {
  it("gives the form its ranges and hints", () => {
    expect(schemaField("clustering.dominantShare")).toMatchObject({ minimum: 0, maximum: 1 });
    expect(schemaField("homes.lat")).toMatchObject({ minimum: -90, maximum: 90 });
    expect(schemaField("immich.marker").description).toContain("prefix");
    expect(schemaField("nope.nothing")).toEqual({});
  });
});
