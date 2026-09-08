import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALBUM_KEY_PERMISSIONS,
  SESSION_LABEL,
  SESSION_SECONDS,
  authMessage,
  createApiKey,
  signIn,
  signOut,
  sweepSessions,
  verifyCredential,
} from "../src/auth.js";
import { normalizeUrl } from "../src/immich.js";

const URL_ = "http://immich.test";

interface Call {
  method: string;
  path: string;
  auth: string | undefined;
  body: any;
}

type Reply = { status?: number; json?: unknown };
type Routes = Record<string, Reply | ((call: Call) => Reply)>;

const calls: Call[] = [];

/** Routes are keyed "METHOD /path", so a test only spells out what it cares about. */
function stub(routes: Routes) {
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const method = init.method ?? "GET";
    const path = String(url).replace(`${URL_}/api`, "");
    const headers = init.headers ?? {};
    const call: Call = {
      method,
      path,
      auth: headers.Authorization ?? headers["x-api-key"],
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const hit = routes[`${method} ${path}`] ?? routes[`${method} ${path.split("?")[0]}`];
    const reply = (typeof hit === "function" ? hit(call) : hit) ?? { status: 404 };
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      text: async () => (reply.json === undefined ? "" : JSON.stringify(reply.json)),
    };
  }) as any;
}

const loginRoutes = (extra: Routes = {}): Routes => ({
  "GET /server/features": { json: { passwordLogin: true, oauth: false } },
  "POST /auth/login": { status: 201, json: { accessToken: "parent-token", userEmail: "me@home.test" } },
  "POST /sessions": { status: 201, json: { token: "child-token", id: "sess-1", expiresAt: "2026-09-09T12:00:00Z" } },
  "POST /auth/logout": { json: { successful: true } },
  "GET /users/me": { json: { email: "me@home.test" } },
  ...extra,
});

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

describe("sign in", () => {
  it("creates a labelled child session with an expiry and drops the login session", async () => {
    stub(loginRoutes());
    const session = await signIn(URL_, "me@home.test", "hunter2");

    expect(session).toEqual({
      token: "child-token",
      email: "me@home.test",
      id: "sess-1",
      expiresAt: "2026-09-09T12:00:00Z",
    });
    const create = calls.find((c) => c.path === "/sessions")!;
    expect(create.body).toEqual({ deviceOS: SESSION_LABEL, deviceType: SESSION_LABEL, duration: SESSION_SECONDS });
    expect(create.auth).toBe("Bearer parent-token");
    expect(calls.some((c) => c.path === "/auth/logout" && c.auth === "Bearer parent-token")).toBe(true);
    // The child is proven alive after the parent goes, otherwise the fallback below kicks in.
    expect(calls.at(-1)).toMatchObject({ path: "/users/me", auth: "Bearer child-token" });
  });

  it("falls back to a fresh login session when the parent logout kills the child", async () => {
    let logouts = 0;
    stub(
      loginRoutes({
        "POST /auth/logout": () => (logouts++, { json: { successful: true } }),
        "GET /users/me": (c) => (c.auth === "Bearer child-token" ? { status: 401 } : { json: { email: "me@home.test" } }),
        "POST /auth/login": {
          status: 201,
          json: { accessToken: logouts ? "parent-2" : "parent-token", userEmail: "me@home.test" },
        },
      }),
    );
    const session = await signIn(URL_, "me@home.test", "hunter2");
    expect(session.id).toBeNull();
    expect(calls.filter((c) => c.path === "/auth/login")).toHaveLength(2);
  });

  it("falls back to the login session when the server has no /sessions", async () => {
    stub(loginRoutes({ "POST /sessions": { status: 404 } }));
    const session = await signIn(URL_, "me@home.test", "hunter2");
    expect(session).toMatchObject({ token: "parent-token", id: null, expiresAt: null });
    expect(calls.some((c) => c.path === "/auth/logout")).toBe(false);
  });

  it("refuses an OAuth only server with something the user can act on", async () => {
    stub(loginRoutes({ "GET /server/features": { json: { passwordLogin: false, oauth: true } } }));
    await expect(signIn(URL_, "me@home.test", "hunter2")).rejects.toThrow(/only allows OAuth/);
    expect(calls.some((c) => c.path === "/auth/login")).toBe(false);
  });

  it("reads a rejected password as a rejected password", async () => {
    stub(loginRoutes({ "POST /auth/login": { status: 401, json: { message: "Incorrect email or password" } } }));
    const e = await signIn(URL_, "me@home.test", "wrong").catch((e) => e);
    expect(authMessage(URL_, e)).toBe("Immich rejected that email and password.");
  });
});

describe("session hygiene", () => {
  it("sweeps only our own leftovers, never the current one", async () => {
    stub({
      "GET /sessions": {
        json: [
          { id: "a", current: true, deviceType: SESSION_LABEL },
          { id: "b", current: false, deviceType: SESSION_LABEL },
          { id: "c", current: false, deviceType: "iPhone" },
        ],
      },
      "DELETE /sessions/b": { json: {} },
    });
    expect(await sweepSessions(URL_, "child-token")).toBe(1);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/sessions/b"]);
  });

  it("signs out by id, or by logout when the session is not ours", async () => {
    stub({ "DELETE /sessions/sess-1": { json: {} }, "POST /auth/logout": { json: {} } });
    await signOut(URL_, { token: "child-token", email: "me@home.test", id: "sess-1", expiresAt: null });
    await signOut(URL_, { token: "parent-token", email: "me@home.test", id: null, expiresAt: null });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /sessions/sess-1", "POST /auth/logout"]);
  });
});

describe("api key", () => {
  it("mints a key scoped to the planner's permissions, on the session token", async () => {
    stub({ "POST /api-keys": { status: 201, json: { secret: "sk-123" } } });
    expect(await createApiKey(URL_, "child-token", "immich-auto-albums")).toBe("sk-123");
    expect(calls[0]).toMatchObject({ auth: "Bearer child-token" });
    expect(calls[0].body).toEqual({ name: "immich-auto-albums", permissions: [...ALBUM_KEY_PERMISSIONS] });
  });

  it("verifies with the key header and fails the whole check when one probe is refused", async () => {
    stub({
      "GET /users/me": { json: { email: "me@home.test" } },
      "GET /albums": { json: [] },
      "POST /search/metadata": { json: { assets: { items: [] } } },
      "GET /people": { status: 403, json: { message: "Not permitted" } },
    });
    const v = await verifyCredential(URL_, { kind: "key", value: "sk-123" });
    expect(v.ok).toBe(false);
    expect(v.email).toBe("me@home.test");
    expect(v.checks.map((c) => c.ok)).toEqual([true, true, true, false]);
    expect(calls.every((c) => c.auth === "sk-123")).toBe(true);
  });

  it("passes when every probe answers", async () => {
    stub({
      "GET /users/me": { json: { email: "me@home.test" } },
      "GET /albums": { json: [] },
      "POST /search/metadata": { json: { assets: { items: [] } } },
      "GET /people": { json: { people: [] } },
    });
    expect((await verifyCredential(URL_, { kind: "bearer", value: "child-token" })).ok).toBe(true);
  });
});

describe("normalizeUrl", () => {
  it("survives what people paste", () => {
    expect(normalizeUrl(" http://nas:2283/ ")).toBe("http://nas:2283");
    expect(normalizeUrl("http://nas:2283/api")).toBe("http://nas:2283");
    expect(normalizeUrl("http://nas:2283/api/")).toBe("http://nas:2283");
  });
});
