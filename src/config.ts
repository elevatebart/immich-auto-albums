import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import type { Config, PlanKind } from "./types.js";

type Raw = Record<string, any>;

/** TOML dates arrive as Date objects; the planner wants YYYY-MM-DD strings. */
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

export function fromToml(text: string): Config {
  const c = parse(text) as Raw;
  const im = c.immich ?? {};
  const pe = c.people;
  const cl = c.clustering;
  const py = c.person_years;
  const se = c.seasons;
  if (!pe || !cl || !py || !se || !c.homes?.length) {
    throw new Error("config: sections people, homes, clustering, person_years and seasons are required");
  }
  return {
    immich: {
      url: im.url ?? "http://localhost:2283",
      outDir: im.out_dir ?? ".",
      windowDays: im.window_days ?? 365,
      marker: im.marker ?? "[auto-albums]",
    },
    people: {
      me: pe.me,
      household: pe.household ?? [],
      withShare: pe.with_share ?? 0.4,
      withMinTagged: pe.with_min_tagged ?? 5,
      maxNamed: pe.max_named ?? 3,
      noPeopleFrom: pe.no_people_from ? day(pe.no_people_from) : undefined,
      noPeopleTo: pe.no_people_to ? day(pe.no_people_to) : undefined,
      noPeoplePlaces: pe.no_people_places ?? [],
    },
    homes: (c.homes as Raw[]).map((h) => ({ from: day(h.from), lat: h.lat, lon: h.lon, label: h.label })),
    clustering: {
      homeKm: cl.home_km,
      placeKm: cl.place_km,
      mergeLabelKm: cl.merge_label_km,
      dominantShare: cl.dominant_share,
      tripGapHours: cl.trip_gap_hours,
      tripMinPhotos: cl.trip_min_photos,
      tripMinDays: cl.trip_min_days,
      daytripMinPhotos: cl.daytrip_min_photos,
      gatherGapHours: cl.gather_gap_hours,
      gatherMinPhotos: cl.gather_min_photos,
      gatherMinGuests: cl.gather_min_guests,
    },
    personYears: { minPhotos: py.min_photos, householdMinPhotos: py.household_min_photos },
    seasons: { noGpsEraEnd: day(se.no_gps_era_end), minPhotos: se.min_photos ?? 5 },
    aliases: { ...(c.aliases ?? {}) },
    events: ((c.events ?? []) as Raw[]).map((e) => ({ name: e.name, from: day(e.from), to: day(e.to) })),
    overrides: ((c.overrides ?? []) as Raw[]).map((o) => ({ kind: o.kind as PlanKind, keyPrefix: o.key_prefix, name: o.name })),
  };
}

export async function loadConfig(path: string): Promise<Config> {
  return fromToml(await readFile(path, "utf8"));
}
