import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { envFilePath, withKey, writeEnvKey } from "../src/env-file.js";

const tmp = () => mkdtemp(path.join(tmpdir(), "iaa-env-"));

describe("withKey", () => {
  it("replaces the line in place and leaves everything else alone", () => {
    const before = "# creds\nIMMICH_API_KEY=old\nIMMICH_URL=http://nas:2283\n";
    expect(withKey(before, "new")).toBe("# creds\nIMMICH_API_KEY=new\nIMMICH_URL=http://nas:2283\n");
  });

  it("appends when the key is absent, and drops a later duplicate", () => {
    expect(withKey("IMMICH_URL=http://nas:2283\n", "new")).toBe("IMMICH_URL=http://nas:2283\nIMMICH_API_KEY=new\n");
    expect(withKey("IMMICH_API_KEY=a\nX=1\nIMMICH_API_KEY=b\n", "new")).toBe("IMMICH_API_KEY=new\nX=1\n");
  });

  it("writes a lone line into an empty file", () => {
    expect(withKey("", "new")).toBe("IMMICH_API_KEY=new\n");
  });
});

describe("writeEnvKey", () => {
  it("keeps the previous text in a .bak", async () => {
    const dir = await tmp();
    const file = path.join(dir, ".env");
    await writeFile(file, "# mine\nIMMICH_API_KEY=old\nGEOCODER=immich\n");
    const out = await writeEnvKey(file, "sk-new");

    expect(out.backup).toBe(`${file}.bak`);
    expect(await readFile(file, "utf8")).toBe("# mine\nIMMICH_API_KEY=sk-new\nGEOCODER=immich\n");
    expect(await readFile(out.backup!, "utf8")).toBe("# mine\nIMMICH_API_KEY=old\nGEOCODER=immich\n");
  });

  it("creates a missing file at 0600 with no backup", async () => {
    const dir = await tmp();
    const file = path.join(dir, ".env");
    const out = await writeEnvKey(file, "sk-new");

    expect(out.backup).toBeNull();
    expect(await readFile(file, "utf8")).toBe("IMMICH_API_KEY=sk-new\n");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

describe("envFilePath", () => {
  it("sits beside the config", () => {
    delete process.env.ENV_FILE;
    expect(envFilePath("/data/config.toml")).toBe("/data/.env");
    process.env.ENV_FILE = "/elsewhere/creds";
    expect(envFilePath("/data/config.toml")).toBe("/elsewhere/creds");
    delete process.env.ENV_FILE;
  });
});
