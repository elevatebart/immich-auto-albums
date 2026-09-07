import type { Action, ManagedAlbum, Plan, PlanKind } from "./types.js";

const STABLE_KINDS: PlanKind[] = ["person", "season", "event"];
const DAY = 86_400_000;

export const descriptionFor = (marker: string, plan: Plan) =>
  `${marker} kind=${plan.kind} key=${plan.key}\nauto: ${plan.name}`;

/**
 * Parse an album description; returns null when the album is not managed.
 * `key` runs to the end of the line, since a person or event key holds a name with spaces in it.
 */
export function parseDescription(marker: string, albumName: string, description: string | null | undefined) {
  if (!description?.startsWith(marker)) return null;
  const [head, ...rest] = description.split("\n");
  const meta = head.slice(marker.length);
  const tail = rest.join("\n");
  return {
    kind: (/\bkind=(\S+)/.exec(meta)?.[1] as PlanKind | undefined) ?? null,
    key: /\bkey=(.*)$/.exec(meta)?.[1].trim() || null,
    auto: tail.startsWith("auto: ") ? tail.slice(6) : albumName,
  };
}

/** Stable-key kinds match by key; event kinds match by >=50% asset overlap within 45 days. */
export function matchExisting(plan: Plan, existing: ManagedAlbum[], used: Set<string>): ManagedAlbum | null {
  const sameKind = existing.filter((al) => al.kind === plan.kind && !used.has(al.id));
  if (STABLE_KINDS.includes(plan.kind)) return sameKind.find((al) => al.key === plan.key) ?? null;
  const ids = new Set(plan.ids);
  let best: ManagedAlbum | null = null;
  let bestScore = 0;
  for (const al of sameKind) {
    if (!al.key) continue;
    const kd = new Date(al.key).getTime();
    if (Number.isNaN(kd) || Math.abs(kd - plan.start.getTime()) > 45 * DAY) continue;
    let inter = 0;
    for (const id of ids) if (al.assets.has(id)) inter++;
    const score = inter / Math.max(1, Math.min(ids.size, al.assets.size));
    if (score > bestScore) [best, bestScore] = [al, score];
  }
  return bestScore >= 0.5 ? best : null;
}

export function reconcile(plans: Plan[], existing: ManagedAlbum[]): Action[] {
  const used = new Set<string>();
  const actions: Action[] = [];
  for (const plan of [...plans].sort((x, y) => x.start.getTime() - y.start.getTime())) {
    const al = matchExisting(plan, existing, used);
    if (!al) {
      actions.push({ op: "create", plan });
      continue;
    }
    used.add(al.id);
    const ids = new Set(plan.ids);
    const add = plan.ids.filter((id) => !al.assets.has(id)).sort();
    const remove = [...al.assets].filter((id) => !ids.has(id)).sort();
    const userRenamed = al.name !== al.auto;
    const rename = !userRenamed && al.name !== plan.name;
    const staleDesc = al.auto !== plan.name;
    const moves = add.length > 0 || remove.length > 0;
    if (!moves && !rename && !staleDesc) actions.push({ op: "noop", plan, album: al });
    else actions.push({ op: moves ? "update" : "rename", plan, album: al, add, remove, rename, userRenamed });
  }
  return actions;
}
