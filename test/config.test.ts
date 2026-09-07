import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromToml, toToml } from "../src/config.js";

const text = readFileSync(new URL("../config.toml", import.meta.url), "utf8");
const cfg = fromToml(text);

describe("toToml", () => {
  it("round trips the shipped config", () => {
    expect(fromToml(toToml(cfg))).toEqual(cfg);
  });

  it("keeps dates bare and stays stable across a second pass", () => {
    const once = toToml(cfg);
    expect(once).toContain("no_gps_era_end = 2012-03-01");
    expect(once).toContain("from = 2023-06-08");
    expect(toToml(fromToml(once))).toBe(once);
  });

  it("drops optional blocks when they are empty", () => {
    const bare = toToml({ ...cfg, aliases: {}, events: [], overrides: [] });
    expect(bare).not.toContain("[aliases]");
    expect(bare).not.toContain("[[events]]");
    expect(fromToml(bare).events).toEqual([]);
  });

  it("escapes quotes in names and alias keys", () => {
    const odd = { ...cfg, aliases: { 'A "B"': "C" }, people: { ...cfg.people, me: 'Bart "the" Ledoux' } };
    const back = fromToml(toToml(odd));
    expect(back.aliases).toEqual({ 'A "B"': "C" });
    expect(back.people.me).toBe('Bart "the" Ledoux');
  });
});
