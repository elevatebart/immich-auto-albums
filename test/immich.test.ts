import { describe, expect, it, vi } from "vitest";
import { ImmichClient } from "../src/immich.js";
import type { Asset } from "../src/types.js";

const URL_ = "http://immich.test";

const asset = (id: string): Asset =>
  ({ id, t: new Date("2024-05-01T10:00:00Z"), lat: null, lon: null, city: null, state: null, country: null, people: new Set() });

const stub = (reply: { status?: number; json?: unknown }) => {
  globalThis.fetch = vi.fn(async () => ({
    ok: (reply.status ?? 200) < 400,
    status: reply.status ?? 200,
    text: async () => (reply.json === undefined ? "" : JSON.stringify(reply.json)),
  })) as any;
};

const client = () => new ImmichClient(URL_, { kind: "key", value: "sk-1" });

describe("attachStacks", () => {
  it("marks every stacked photo with its primary, and leaves unstacked photos alone", async () => {
    stub({
      json: [
        { id: "s1", primaryAssetId: "a1", assets: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] },
        { id: "s2", primaryAssetId: "b1", assets: [{ id: "b1" }, { id: "b2" }] },
      ],
    });
    const assets = new Map(["a1", "a2", "a3", "b1", "b2", "c1"].map((id) => [id, asset(id)]));
    expect(await client().attachStacks(assets)).toBe(3);
    expect([...assets.values()].map((a) => a.stackPrimary)).toEqual([undefined, "a1", "a1", undefined, "b1", undefined]);
  });

  it("ignores stacked photos outside the fetched window", async () => {
    stub({ json: [{ id: "s1", primaryAssetId: "old1", assets: [{ id: "old1" }, { id: "old2" }] }] });
    const assets = new Map([["a1", asset("a1")]]);
    expect(await client().attachStacks(assets)).toBe(0);
    expect(assets.get("a1")!.stackPrimary).toBeUndefined();
  });

  it("propagates a refused read, since planning as if nothing were stacked would be wrong", async () => {
    stub({ status: 403, json: { message: "Not permitted" } });
    await expect(client().attachStacks(new Map())).rejects.toThrow("403");
  });
});
