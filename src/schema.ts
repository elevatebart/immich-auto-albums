
export const DAY_PATTERN = "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$";

const int = (minimum: number, maximum: number, description: string) => ({ type: "integer", minimum, maximum, description });
const num = (minimum: number, maximum: number, description: string) => ({ type: "number", minimum, maximum, description });
const text = (description: string) => ({ type: "string", minLength: 1, description });
/** Both keywords on purpose: `format` needs ajv-formats, `pattern` works in any validator. */
const day = (description: string) => ({ type: "string", format: "date", pattern: DAY_PATTERN, description });
const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  description,
  properties,
  required: Object.keys(properties).filter((k) => !("default" in (properties[k] as object)) && !OPTIONAL.has(k)),
  additionalProperties: false,
});

const OPTIONAL = new Set(["label"]);

/** JSON Schema for `Config`, the camelCase shape. TOML key mapping stays in config.ts. */
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/immich-auto-albums/config.schema.json",
  title: "immich-auto-albums config",
  ...obj({
    immich: obj({
      url: text("Immich base URL, without the /api suffix."),
      outDir: text("Where the CLI writes logs and decision CSVs."),
      windowDays: int(1, 3650, "Rolling window for trips, day trips and gatherings."),
      marker: text("Album description prefix. Only albums carrying it are ever touched."),
    }),
    people: obj({
      me: text("Immich person name of the library owner."),
      household: { type: "array", items: text("Immich person name."), default: [], description: "Never named in a title, and eligible for a person year on a lower photo count." },
      withShare: num(0, 1, "Share of a trip's face-tagged photos a guest must appear in to be named."),
      withMinTagged: int(0, 500, "Minimum face-tagged photos in a cluster before anyone is named."),
      maxNamed: int(1, 20, "Maximum guests named in one album title."),
      noPeoplePlaces: { type: "array", items: text("Place name as it appears in album titles."), default: [], description: "Places whose albums never name anyone." },
    }),
    homes: {
      type: "array",
      minItems: 1,
      description: "Homes in chronological order. Each applies until the next one starts.",
      items: obj({
        from: day("First day this home applies."),
        lat: num(-90, 90, "Latitude."),
        lon: num(-180, 180, "Longitude."),
        label: text("Name for your own reference. Never used in an album title."),
      }),
    },
    clustering: obj({
      homeKm: num(0.1, 500, "Photos within this radius of the current home count as at home."),
      placeKm: num(0.1, 500, "Groups photos around a running centroid before naming a place."),
      mergeLabelKm: num(0.1, 500, "Merges nearby place groups before picking the album name."),
      dominantShare: num(0, 1, "Share of a trip's GPS photos one place needs to name the album."),
      regionShare: { ...num(0, 1, "Share one region needs before the other regions are ignored in the name."), default: 0.8 },
      zoneShare: { ...num(0, 1, "Share of a trip's GPS photos a named zone needs to name the album."), default: 0.6 },
      tripGapHours: num(1, 8760, "A gap longer than this starts a new trip."),
      tripMinPhotos: int(1, 1000, "Minimum photos for a trip."),
      tripMinDays: int(1, 365, "Minimum distinct days for a trip. Below this it is considered a day trip."),
      daytripMinPhotos: int(1, 1000, "Minimum photos on the busiest day for a day trip."),
      gatherGapHours: num(0.1, 168, "A gap longer than this starts a new gathering."),
      gatherMinPhotos: int(1, 1000, "Minimum photos for a gathering at home."),
      gatherMinGuests: int(1, 100, "Minimum named non-household faces for a gathering."),
      eventAbsorbShare: { ...num(0, 1, "Share of a cluster's photos and of its days inside a hand-declared event before it folds into that event."), default: 0.5 },
    }),
    personYears: obj({
      minPhotos: int(1, 5000, "Minimum photos of a person in a year for their album."),
      householdMinPhotos: int(1, 5000, "Same, for household members."),
    }),
    seasons: obj({
      noGpsEraEnd: day("Seasonal buckets only cover GPS-less photos before this date."),
      minPhotos: int(1, 1000, "Minimum photos for a seasonal album."),
    }),
    zones: {
      type: "array",
      default: [],
      description: "Named areas that beat the district when a trip mostly happened inside one.",
      items: obj({
        name: text("Name used in album titles."),
        lat: num(-90, 90, "Latitude of the centre."),
        lon: num(-180, 180, "Longitude of the centre."),
        km: num(0.1, 500, "Radius around the centre."),
      }),
    },
    naming: {
      ...obj({
        districtCountries: {
          type: "array",
          items: text("Country name as the geocoder spells it."),
          default: ["France"],
          description: "Countries whose albums are named after the district (admin2) rather than the region.",
        },
        keepRegions: {
          type: "array",
          items: text("Region name as the geocoder spells it."),
          default: ["Normandy", "Île-de-France"],
          description: "Regions that keep naming albums even in a district country.",
        },
      }),
      default: { districtCountries: ["France"], keepRegions: ["Normandy", "Île-de-France"] },
    },
    aliases: {
      type: "object",
      default: {},
      description: "Geocoder label to the name used in albums. Applies to cities, districts and states.",
      propertyNames: { minLength: 1 },
      additionalProperties: text("Name used in album titles."),
    },
    events: {
      type: "array",
      default: [],
      description: "Hand-declared events. Every photo in the inclusive range joins the album.",
      items: obj({
        name: text("Album name, without the date suffix."),
        from: day("First day, inclusive."),
        to: day("Last day, inclusive."),
      }),
    },
  }),
} as const;

export interface ConfigIssue {
  field: string;
  message: string;
}

/** Schema node for a dotted path, so a form can read ranges and descriptions from one place. */
export function schemaField(path: string): { minimum?: number; maximum?: number; description?: string; enum?: string[] } {
  let node: any = configSchema;
  for (const seg of path.split(".")) {
    node = node?.properties?.[seg] ?? node?.items?.properties?.[seg];
    if (!node) return {};
  }
  return node;
}
