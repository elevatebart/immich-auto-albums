import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { ImmichClient, ImmichHttpError } from "./immich.js";
import { runLogin } from "./login.js";
import { dayOf, makeContext, plan, taggedSince } from "./planner.js";
import { descriptionFor, orphans, reconcile } from "./reconcile.js";
import type { Scope } from "./types.js";

const mode = process.argv[2] === "apply" ? "apply" : "preview";
const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG ?? path.resolve(here, "..", "config.toml");

// login runs before the config is required, since a first run has no config.toml yet.
if (process.argv[2] === "login") {
  const soft = await loadConfig(configPath).catch(() => null);
  process.exit(
    await runLogin({
      configFile: configPath,
      defaultUrl: process.env.IMMICH_URL ?? soft?.immich.url ?? "http://localhost:2283",
      save: process.argv.includes("--save"),
    }),
  );
}

const cfg = await loadConfig(configPath).catch((e: NodeJS.ErrnoException) => {
  const hint = e.code === "ENOENT" ? "Copy config.example.toml to config.toml, or set CONFIG." : e.message;
  console.error(`no usable config at ${configPath}. ${hint}`);
  process.exit(1);
});

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
  log("FATAL: IMMICH_API_KEY not set. Run `npm run login` to create one.");
  process.exit(1);
}
const client = new ImmichClient(url, { kind: "key", value: apiKey });
const ctx = makeContext(cfg, new Date(), windowDays, scope);
log(
  `Started. mode=${mode} scope=${scope} window since ${ctx.windowStart.toISOString().slice(0, 10)}` +
    (scope === "window" ? " (person years, seasons and events outside it are left alone; --all for everything)" : ""),
);
await client.checkAuth().catch((e: Error) => {
  const status = e instanceof ImmichHttpError ? e.status : 0;
  const hint =
    status === 401 || status === 403
      ? "IMMICH_API_KEY was rejected. Run `npm run login` to create one."
      : `cannot reach Immich at ${url}: ${e.message}`;
  log(`FATAL: ${hint}`);
  process.exit(1);
});

const assets = await client.fetchAssets(scope === "window" ? ctx.windowStart : undefined);
log(`Assets: ${assets.size} (${[...assets.values()].filter((a) => a.lat !== null).length} with GPS)`);
const districts = await client.attachDistricts(assets, cfg.naming.districtCountries);
if (districts.size) {
  const named = [...assets.values()].filter((a) => a.district).length;
  log(`Districts: ${districts.size} cities looked up, ${named} photos got one`);
}
const people = await client.fetchPeople();
log(`Named people: ${people.length}`);
const counts = await client.attachPeople(assets, people, taggedSince(ctx));
for (const [name, n] of Object.entries(counts)) log(`  people: ${name} -> ${n}`);
const named = [...cfg.people.household, ...cfg.personYears.favorites];
const missing = [...new Set(named)].filter((h) => !people.some((p) => p.name === h));
if (missing.length) log(`WARN: configured names not found in Immich People: ${missing.join(", ")}`);

const { plans, absorbed, folded } = plan(cfg, [...assets.values()], { windowDays, scope });
const byKind = plans.reduce<Record<string, number>>((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {});
log(`Plans: ${JSON.stringify(byKind)}; GPS-less photos absorbed into trips: ${absorbed.size}`);
for (const f of folded) log(`  folded ${f.plan.kind} "${f.plan.name}" (${f.plan.ids.length}) into event "${f.event}"`);

const existing = await client.fetchManagedAlbums(cfg.immich.marker);
log(`Existing auto albums: ${existing.length}`);
const actions = reconcile(plans, existing);
const stale = orphans(actions, existing, scope === "window" ? dayOf(ctx.windowStart) : undefined);
if (stale.length) {
  log(`WARN: ${stale.length} auto albums no longer have a plan, delete them in Immich if you want them gone:`);
  for (const al of stale) log(`          ${al.name}`);
}

const csv = ["kind,action,album,assets,detail,error"];
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
let failed = 0;

/** One album's writes. A failure is recorded and the run carries on to the next album. */
async function write(a: Extract<(typeof actions)[number], { op: "create" | "update" | "rename" }>) {
  const desc = descriptionFor(cfg.immich.marker, a.plan);
  if (a.op === "create") {
    await client.createAlbum(a.plan.name, desc, [...a.plan.ids].sort());
    return;
  }
  await client.updateAlbum(a.album.id, a.userRenamed ? a.album.name : a.plan.name, desc);
  if (a.add.length) await client.addAssets(a.album.id, a.add);
  if (a.remove.length) await client.removeAssets(a.album.id, a.remove);
}

for (const a of actions) {
  if (a.op === "noop") continue;
  const detail =
    a.op === "create"
      ? `key=${a.plan.key}`
      : `+${a.add.length} -${a.remove.length}` +
        (a.rename ? `, was: ${a.album.name}` : "") +
        (a.userRenamed ? ", keeping your name" : "");
  let error = "";
  if (mode === "apply") {
    try {
      await write(a);
    } catch (e) {
      error = (e as Error).message;
      failed++;
    }
  }
  csv.push([a.plan.kind, a.op, q(a.plan.name), a.plan.ids.length, q(detail), q(error)].join(","));
  log(`  ${error ? "FAILED " : a.op.padEnd(7)} ${a.plan.kind.padEnd(9)} ${a.plan.name} (${detail})`);
  if (error) log(`          ${error}`);
}

// The CSV is the audit trail, so it records what vanished as well as what was written.
for (const f of folded) csv.push([f.plan.kind, "folded", q(f.plan.name), f.plan.ids.length, q(`into ${f.event}`), ""].join(","));
for (const al of stale) csv.push([al.kind ?? "", "orphan", q(al.name), al.assets.size, q("left alone"), ""].join(","));

const csvPath = path.join(outDir, `decisions_${stamp}.csv`);
await writeFile(csvPath, csv.join("\n") + "\n");
await writeFile(path.join(outDir, `plan_${stamp}.json`), JSON.stringify(plans, (_, v) => (v instanceof Set ? [...v] : v), 2));
log(`Decision log: ${csvPath}`);
if (mode !== "apply") log("PREVIEW, nothing written to Immich. Run 'apply' to write.");
if (failed) {
  log(`FAILED on ${failed} album(s). The rest went through; the CSV has a message per failure.`);
  process.exitCode = 1;
}
log("Done.");
await writeFile(path.join(outDir, `run_${stamp}.log`), lines.join("\n") + "\n");
