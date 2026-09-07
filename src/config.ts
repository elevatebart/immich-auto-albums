import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { validateConfig } from "./validate.js";
import type { Config } from "./types.js";

type Raw = Record<string, any>;

/** TOML dates arrive as Date objects; the planner wants YYYY-MM-DD strings. */
const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

export function fromToml(text: string): Config {
  const c = parse(text) as Raw;
  const im = c.immich ?? {};
  const pe = c.people ?? {};
  const cl = c.clustering ?? {};
  const py = c.person_years ?? {};
  const se = c.seasons ?? {};
  const raw = {
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
      noPeoplePlaces: pe.no_people_places ?? [],
    },
    homes: ((c.homes ?? []) as Raw[]).map((h) => ({ from: day(h.from), lat: h.lat, lon: h.lon, label: h.label })),
    clustering: {
      homeKm: cl.home_km,
      placeKm: cl.place_km,
      mergeLabelKm: cl.merge_label_km,
      dominantShare: cl.dominant_share,
      regionShare: cl.region_share ?? 0.8,
      tripGapHours: cl.trip_gap_hours,
      tripMinPhotos: cl.trip_min_photos,
      tripMinDays: cl.trip_min_days,
      daytripMinPhotos: cl.daytrip_min_photos,
      gatherGapHours: cl.gather_gap_hours,
      gatherMinPhotos: cl.gather_min_photos,
      gatherMinGuests: cl.gather_min_guests,
    },
    personYears: { minPhotos: py.min_photos, householdMinPhotos: py.household_min_photos },
    seasons: { noGpsEraEnd: se.no_gps_era_end === undefined ? undefined : day(se.no_gps_era_end), minPhotos: se.min_photos ?? 5 },
    aliases: { ...(c.aliases ?? {}) },
    events: ((c.events ?? []) as Raw[]).map((e) => ({ name: e.name, from: day(e.from), to: day(e.to) })),
  };
  const { config, issues } = validateConfig(raw);
  if (issues.length) {
    throw new Error(`config: ${issues.map((i) => `${i.field} ${i.message}`).join("; ")}`);
  }
  return config;
}

export async function loadConfig(path: string): Promise<Config> {
  return fromToml(await readFile(path, "utf8"));
}

const q = (s: string) => JSON.stringify(s);
const list = (xs: string[]) => `[${xs.map(q).join(", ")}]`;

/** Canonical config.toml for a Config. The comments are this template's, not the input file's. */
export function toToml(c: Config): string {
  const out: string[] = [];
  const row = (k: string, v: string | number, comment?: string) => {
    const kv = `${k} = ${v}`;
    out.push(comment ? `${kv.padEnd(31)} # ${comment}` : kv);
  };
  const head = (s: string) => out.push("", s);

  out.push(
    "# immich_auto_albums configuration. Dates are TOML dates (YYYY-MM-DD).",
    "# The API key is NOT here: pass IMMICH_API_KEY in the environment.",
  );
  head("[immich]");
  row("url", q(c.immich.url));
  row("out_dir", q(c.immich.outDir), "logs and decision CSVs");
  row("window_days", c.immich.windowDays, "rolling recompute window; WINDOW_DAYS env overrides");
  row("marker", q(c.immich.marker), "album description prefix; only tagged albums are ever touched");

  head("[people]");
  row("me", q(c.people.me));
  row("household", list(c.people.household));
  row("with_share", c.people.withShare, "share of a trip's face-tagged photos a guest must appear in to be named");
  row("with_min_tagged", c.people.withMinTagged, "minimum face-tagged photos before naming anyone");
  row("max_named", c.people.maxNamed);
  row("no_people_places", list(c.people.noPeoplePlaces));

  head("# Homes, in chronological order. Each applies until the next one starts.");
  for (const h of c.homes) {
    out.push("[[homes]]");
    row("from", h.from);
    row("lat", h.lat);
    row("lon", h.lon);
    if (h.label) row("label", q(h.label));
    out.push("");
  }
  out.pop();

  head("[clustering]");
  for (const [k, v] of [
    ["home_km", c.clustering.homeKm],
    ["place_km", c.clustering.placeKm],
    ["merge_label_km", c.clustering.mergeLabelKm],
    ["dominant_share", c.clustering.dominantShare],
    ["region_share", c.clustering.regionShare],
    ["trip_gap_hours", c.clustering.tripGapHours],
    ["trip_min_photos", c.clustering.tripMinPhotos],
    ["trip_min_days", c.clustering.tripMinDays],
    ["daytrip_min_photos", c.clustering.daytripMinPhotos],
    ["gather_gap_hours", c.clustering.gatherGapHours],
    ["gather_min_photos", c.clustering.gatherMinPhotos],
    ["gather_min_guests", c.clustering.gatherMinGuests],
  ] as [string, number][]) {
    row(k, v);
  }

  head("[person_years]");
  row("min_photos", c.personYears.minPhotos);
  row("household_min_photos", c.personYears.householdMinPhotos);

  head("[seasons]");
  row("no_gps_era_end", c.seasons.noGpsEraEnd, "seasonal buckets only for GPS-less photos before this date");
  row("min_photos", c.seasons.minPhotos);

  const aliases = Object.entries(c.aliases);
  if (aliases.length) {
    head("# Geocoder label -> name used in albums. Applies to cities and states.");
    out.push("[aliases]");
    for (const [from, to] of aliases) row(q(from), q(to));
  }

  if (c.events.length) {
    head("# Hand-declared events: every photo in the inclusive range, GPS or not.");
    for (const e of c.events) {
      out.push("[[events]]");
      row("name", q(e.name));
      row("from", e.from);
      row("to", e.to);
      out.push("");
    }
    out.pop();
  }

  return out.join("\n") + "\n";
}
