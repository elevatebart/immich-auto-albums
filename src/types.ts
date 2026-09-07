/** Asset as the planner sees it. `t` is the local capture time encoded as UTC (use getUTC* accessors). */
export interface Asset {
  id: string;
  t: Date;
  lat: number | null;
  lon: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  people: Set<string>;
}

export interface Home {
  from: string; // YYYY-MM-DD
  lat: number;
  lon: number;
  label?: string;
}

export interface FixedEvent {
  name: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;
}

export interface NameOverride {
  kind: PlanKind;
  keyPrefix: string;
  name: string;
}

export interface Config {
  immich: { url: string; outDir: string; windowDays: number; marker: string };
  people: {
    me: string;
    household: string[];
    withShare: number;
    withMinTagged: number;
    maxNamed: number;
    noPeopleFrom?: string;
    noPeopleTo?: string;
    noPeoplePlaces: string[];
  };
  homes: Home[];
  clustering: {
    homeKm: number;
    placeKm: number;
    mergeLabelKm: number;
    dominantShare: number;
    tripGapHours: number;
    tripMinPhotos: number;
    tripMinDays: number;
    daytripMinPhotos: number;
    gatherGapHours: number;
    gatherMinPhotos: number;
    gatherMinGuests: number;
  };
  personYears: { minPhotos: number; householdMinPhotos: number };
  seasons: { noGpsEraEnd: string; minPhotos: number };
  aliases: Record<string, string>;
  events: FixedEvent[];
  overrides: NameOverride[];
}

export type PlanKind = "trip" | "daytrip" | "gathering" | "person" | "season" | "event";

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
  | { op: "update"; plan: Plan; album: ManagedAlbum; add: string[]; remove: string[]; rename: boolean; userRenamed: boolean }
  | { op: "noop"; plan: Plan; album: ManagedAlbum };
