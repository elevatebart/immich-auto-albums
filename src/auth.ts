import { ImmichHttpError, request } from "./immich.js";
import type { Credential } from "./types.js";

/** A session lasts a day, then the user signs in again. Long enough for any preview or apply. */
export const SESSION_SECONDS = 86_400;

/** Stamped on the session we create so a later sign in can recognise and clean up our leftovers. */
export const SESSION_LABEL = "immich-auto-albums";

/** Everything the planner and the UI read, and nothing else. Kept here so there is one list. */
export const ALBUM_KEY_PERMISSIONS = [
  "asset.read",
  "asset.view",
  "person.read",
  "album.read",
  "album.create",
  "album.update",
  "albumAsset.create",
  "albumAsset.delete",
  "user.read",
] as const;

export interface Session {
  token: string;
  email: string;
  /** Set when the session is one we created, which is the only kind we can delete by id. */
  id: string | null;
  expiresAt: string | null;
}

export interface Check {
  label: string;
  permission: string;
  ok: boolean;
  detail?: string;
}

export interface Verified {
  ok: boolean;
  email: string | null;
  checks: Check[];
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Turns any failure of the credential dance into one line a non-technical user can act on. */
export function authMessage(url: string, e: unknown): string {
  if (e instanceof AuthError) return e.message;
  if (e instanceof ImmichHttpError) {
    if (e.status === 401) return "Immich rejected that email and password.";
    if (e.status === 403) return "That account is not allowed to do this.";
    if (e.status === 404) return `No Immich API at ${url}. Check the address.`;
    return `Immich answered ${e.status}: ${e.body.slice(0, 200)}`;
  }
  return `Cannot reach Immich at ${url}: ${(e as Error).message}`;
}

const bearer = (token: string): Credential => ({ kind: "bearer", value: token });

export async function serverFeatures(url: string): Promise<{ passwordLogin: boolean; oauth: boolean }> {
  const f = await request<Record<string, boolean>>(url, "GET", "/server/features");
  return { passwordLogin: f?.passwordLogin !== false, oauth: f?.oauth === true };
}

/** Signs in and returns the token to work with. Nothing here touches disk. */
export async function signIn(url: string, email: string, password: string): Promise<Session> {
  const features = await serverFeatures(url);
  if (!features.passwordLogin) {
    throw new AuthError(
      400,
      "This Immich only allows OAuth sign in. Create an API key in Immich under Account Settings, then paste it in Advanced.",
    );
  }
  const login = await request<{ accessToken: string; userEmail: string }>(url, "POST", "/auth/login", {
    body: { email, password },
  });

  const child = await childSession(url, login.accessToken);
  if (!child) return { token: login.accessToken, email: login.userEmail, id: null, expiresAt: null };

  // The child outlives the login session only on some versions, so prove it before dropping the parent.
  await request(url, "POST", "/auth/logout", { cred: bearer(login.accessToken) }).catch(() => null);
  if (await alive(url, child.token)) return { ...child, email: login.userEmail };

  const again = await request<{ accessToken: string; userEmail: string }>(url, "POST", "/auth/login", {
    body: { email, password },
  });
  return { token: again.accessToken, email: again.userEmail, id: null, expiresAt: null };
}

/** A labelled session with its own expiry. Null when the server is too old to have the endpoint. */
async function childSession(url: string, token: string) {
  try {
    const s = await request<{ token: string; id: string; expiresAt?: string }>(url, "POST", "/sessions", {
      cred: bearer(token),
      body: { deviceOS: SESSION_LABEL, deviceType: SESSION_LABEL, duration: SESSION_SECONDS },
    });
    return { token: s.token, id: s.id, expiresAt: s.expiresAt ?? null };
  } catch (e) {
    if (e instanceof ImmichHttpError && (e.status === 400 || e.status === 404)) return null;
    throw e;
  }
}

const alive = (url: string, token: string) =>
  request(url, "GET", "/users/me", { cred: bearer(token) }).then(
    () => true,
    () => false,
  );

export async function signOut(url: string, session: Session): Promise<void> {
  const cred = bearer(session.token);
  const path = session.id ? `/sessions/${session.id}` : "/auth/logout";
  await request(url, session.id ? "DELETE" : "POST", path, { cred }).catch(() => null);
}

/** Deletes the sessions a crashed run left behind. Ours is the current one, so it is skipped. */
export async function sweepSessions(url: string, token: string): Promise<number> {
  const cred = bearer(token);
  const all = await request<{ id: string; current: boolean; deviceType: string }[]>(url, "GET", "/sessions", {
    cred,
  }).catch(() => []);
  const stale = (all ?? []).filter((s) => !s.current && s.deviceType === SESSION_LABEL);
  for (const s of stale) await request(url, "DELETE", `/sessions/${s.id}`, { cred }).catch(() => null);
  return stale.length;
}

/** Mints a key scoped to ALBUM_KEY_PERMISSIONS. Returns the secret, which Immich shows only once. */
export async function createApiKey(url: string, token: string, name: string): Promise<string> {
  const res = await request<{ secret: string }>(url, "POST", "/api-keys", {
    cred: bearer(token),
    body: { name, permissions: [...ALBUM_KEY_PERMISSIONS] },
  });
  return res.secret;
}

/** One cheap call per permission the planner reads, so a credential is proven before it is offered. */
export async function verifyCredential(url: string, cred: Credential): Promise<Verified> {
  const probes: { label: string; permission: string; run: () => Promise<unknown> }[] = [
    { label: "read your account", permission: "user.read", run: () => request(url, "GET", "/users/me", { cred }) },
    { label: "list albums", permission: "album.read", run: () => request(url, "GET", "/albums", { cred }) },
    {
      label: "read photos",
      permission: "asset.read",
      run: () => request(url, "POST", "/search/metadata", { cred, body: { size: 1, page: 1 } }),
    },
    { label: "read people", permission: "person.read", run: () => request(url, "GET", "/people?size=1", { cred }) },
  ];
  let email: string | null = null;
  const checks: Check[] = [];
  for (const p of probes) {
    try {
      const res: any = await p.run();
      if (p.permission === "user.read") email = res?.email ?? null;
      checks.push({ label: p.label, permission: p.permission, ok: true });
    } catch (e) {
      checks.push({ label: p.label, permission: p.permission, ok: false, detail: authMessage(url, e) });
    }
  }
  return { ok: checks.every((c) => c.ok), email, checks };
}

/** Writing to albums cannot be probed without changing the library, so it is only reported. */
export const UNTESTED_PERMISSIONS = ["album.create", "album.update", "albumAsset.create", "albumAsset.delete"];
