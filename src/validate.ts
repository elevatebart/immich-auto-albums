import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import * as ajvFormats from "ajv-formats";
import { configSchema, type ConfigIssue } from "./schema.js";
import type { Config } from "./types.js";

// ajv-formats is CJS with only a default export, so reach through the namespace.
const addFormats = (ajvFormats as unknown as { default: (ajv: Ajv2020, formats: string[]) => void }).default;

const ajv = new Ajv2020({ allErrors: true, useDefaults: true, strictTypes: false });
addFormats(ajv, ["date"]);
const validate = ajv.compile<Config>(configSchema as object);

/** `/homes/1/from` reads as `homes[1].from`, which is what the form labels its fields. */
function fieldOf(instancePath: string, missing?: string): string {
  const path = instancePath
    .split("/")
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
    .join("")
    .replace(/^\./, "");
  if (!missing) return path;
  return path ? `${path}.${missing}` : missing;
}

const isDay = (v: unknown): v is string => typeof v === "string";

/** Order rules JSON Schema cannot express. Runs on any shape, so one pass reports everything. */
function crossFieldIssues(cfg: Partial<Config>): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const homes = Array.isArray(cfg?.homes) ? cfg.homes : [];
  homes.forEach((h, i) => {
    const prev = homes[i - 1];
    if (i && isDay(h?.from) && isDay(prev?.from) && h.from < prev.from) {
      issues.push({ field: `homes[${i}].from`, message: "must not be before the previous home" });
    }
  });
  const events = Array.isArray(cfg?.events) ? cfg.events : [];
  events.forEach((e, i) => {
    if (isDay(e?.from) && isDay(e?.to) && e.to < e.from) {
      issues.push({ field: `events[${i}].to`, message: "must not be before from" });
    }
  });
  return issues;
}

/** Validates untrusted input against the schema, filling defaults. Collects every problem. */
export function validateConfig(raw: unknown): { config: Config; issues: ConfigIssue[] } {
  const config = structuredClone(raw) as Config;
  const ok = validate(config);
  const schemaIssues = ok
    ? []
    : (validate.errors ?? []).map((e: ErrorObject) => ({
        field: fieldOf(e.instancePath, (e.params?.missingProperty ?? e.params?.additionalProperty) as string | undefined),
        message: e.message ?? "is invalid",
      }));
  return { config, issues: [...schemaIssues, ...crossFieldIssues(config)] };
}
