/** Asset as the planner sees it. `t` is the local capture time encoded as UTC (use getUTC* accessors). */
export interface Asset {
  id: string;
  t: Date;
  lat: number | null;
  lon: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  /** Geocoder admin2, a French departement. Not in Immich exif; the fetch layer looks it up. */
  district?: string | null;
  people: Set<string>;
}

export interface Home {
  from: string; // YYYY-MM-DD
  lat: number;
  lon: number;
  label?: string;
}

/** Hand-declared area. Names a trip that mostly happened inside it, ahead of the district. */
export interface Zone {
  name: string;
  lat: number;
  lon: number;
  km: number;
}

export interface FixedEvent {
  name: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;
}

export interface Config {
  immich: { url: string; outDir: string; windowDays: number; marker: string };
  people: {
    me: string;
    household: string[];
    withShare: number;
    withMinTagged: number;
    maxNamed: number;
    noPeoplePlaces: string[];
  };
  homes: Home[];
  clustering: {
    homeKm: number;
    placeKm: number;
    placeKmMax: number;
    mergeLabelKm: number;
    dominantShare: number;
    regionShare: number;
    leadShare: number;
    zoneShare: number;
    tripGapHours: number;
    tripMinPhotos: number;
    tripMinDays: number;
    daytripMinPhotos: number;
    gatherGapHours: number;
    gatherMinPhotos: number;
    gatherMinGuests: number;
    eventAbsorbShare: number;
  };
  personYears: { favorites: string[]; minPhotos: number; householdMinPhotos: number };
  seasons: { noGpsEraEnd: string; minPhotos: number };
  naming: { districtCountries: string[]; keepRegions: string[] };
  zones: Zone[];
  aliases: Record<string, string>;
  events: FixedEvent[];
}

export type PlanKind = "trip" | "daytrip" | "gathering" | "person" | "season" | "event";

/** How much history a run looks at. "window" is the rolling window, "all" is the whole library. */
export type Scope = "window" | "all";

export interface Plan {
  kind: PlanKind;
  key: string;
  name: string;
  ids: string[];
  start: Date;
  /** Centroid of GPS photos, for map previews. */
  centroid?: { lat: number; lon: number };
}

/** Existing Immich album already tagged by the marker. */
export interface ManagedAlbum {
  id: string;
  name: string;
  auto: string; // name the tool generated last time
  kind: PlanKind | null;
  key: string | null;
  assets: Set<string>;
}

export type Action =
  | { op: "create"; plan: Plan }
  /** "update" moves photos, "rename" only writes the title and the auto line. */
  | { op: "update" | "rename"; plan: Plan; album: ManagedAlbum; add: string[]; remove: string[]; rename: boolean; userRenamed: boolean }
  | { op: "noop"; plan: Plan; album: ManagedAlbum };

/** How a request authenticates: a long lived API key, or a session token from a sign in. */
export type Credential = { kind: "key" | "bearer"; value: string };
