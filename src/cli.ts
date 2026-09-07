import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { ImmichClient } from "./immich.js";
import { makeContext, plan, taggedSince } from "./planner.js";
import { descriptionFor, reconcile } from "./reconcile.js";
import type { Scope } from "./types.js";

const mode = process.argv[2] === "apply" ? "apply" : "preview";
const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG ?? path.resolve(here, "..", "config.toml");
const cfg = await loadConfig(configPath);

const url = process.env.IMMICH_URL ?? cfg.immich.url;
const apiKey = process.env.IMMICH_API_KEY ?? "";
const outDir = process.env.OUT ?? cfg.immich.outDir;
const windowDays = Number(process.env.WINDOW_DAYS ?? cfg.immich.windowDays);
const scope: Scope = process.argv.includes("--all") || process.env.SCOPE === "all" ? "all" : "window";
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "_");

await mkdir(outDir, { recursive: true });
const lines: string[] = [];
const log = (msg: string) => {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
  console.log(line);
  lines.push(line);
};

if (!apiKey) {
  log("FATAL: IMMICH_API_KEY not set");
  process.exit(1);
}
const client = new ImmichClient(url, apiKey);
const ctx = makeContext(cfg, new Date(), windowDays, scope);
log(
  `Started. mode=${mode} scope=${scope} window since ${ctx.windowStart.toISOString().slice(0, 10)}` +
    (scope === "window" ? " (person years, seasons and events outside it are left alone; --all for everything)" : ""),
);
await client.checkAuth();

const assets = await client.fetchAssets(scope === "window" ? ctx.windowStart : undefined);
log(`Assets: ${assets.size} (${[...assets.values()].filter((a) => a.lat !== null).length} with GPS)`);
const people = await client.fetchPeople();
log(`Named people: ${people.length}`);
const counts = await client.attachPeople(assets, people, taggedSince(ctx));
for (const [name, n] of Object.entries(counts)) log(`  people: ${name} -> ${n}`);
const missing = cfg.people.household.filter((h) => !people.some((p) => p.name === h));
if (missing.length) log(`WARN: household names not found in Immich People: ${missing.join(", ")}`);

const { plans, absorbed } = plan(cfg, [...assets.values()], { windowDays, scope });
const byKind = plans.reduce<Record<string, number>>((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {});
log(`Plans: ${JSON.stringify(byKind)}; GPS-less photos absorbed into trips: ${absorbed.size}`);

const existing = await client.fetchManagedAlbums(cfg.immich.marker);
log(`Existing auto albums: ${existing.length}`);
const actions = reconcile(plans, existing);

const csv = ["kind,action,album,assets,detail"];
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
for (const a of actions) {
  if (a.op === "noop") continue;
  const desc = descriptionFor(cfg.immich.marker, a.plan);
  if (a.op === "create") {
    csv.push([a.plan.kind, "create", q(a.plan.name), a.plan.ids.length, ""].join(","));
    log(`  create  ${a.plan.kind.padEnd(9)} ${a.plan.name} (${a.plan.ids.length}) key=${a.plan.key}`);
    if (mode === "apply") await client.createAlbum(a.plan.name, desc, [...a.plan.ids].sort());
    continue;
  }
  const detail =
    `+${a.add.length} -${a.remove.length}` +
    (a.rename ? `, was: ${a.album.name}` : "") +
    (a.userRenamed ? ", keeping your name" : "");
  csv.push([a.plan.kind, "update", q(a.plan.name), a.plan.ids.length, q(detail)].join(","));
  log(`  update  ${a.plan.kind.padEnd(9)} ${a.plan.name} (${detail})`);
  if (mode !== "apply") continue;
  await client.updateAlbum(a.album.id, a.userRenamed ? a.album.name : a.plan.name, desc);
  if (a.add.length) await client.addAssets(a.album.id, a.add);
  if (a.remove.length) await client.removeAssets(a.album.id, a.remove);
}

const csvPath = path.join(outDir, `decisions_${stamp}.csv`);
await writeFile(csvPath, csv.join("\n") + "\n");
await writeFile(path.join(outDir, `plan_${stamp}.json`), JSON.stringify(plans, (_, v) => (v instanceof Set ? [...v] : v), 2));
log(`Decision log: ${csvPath}`);
if (mode !== "apply") log("PREVIEW, nothing written to Immich. Run 'apply' to write.");
log("Done.");
await writeFile(path.join(outDir, `run_${stamp}.log`), lines.join("\n") + "\n");
