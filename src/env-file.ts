import { chmod, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const KEY = "IMMICH_API_KEY";
const isKeyLine = (line: string) => new RegExp(`^\\s*${KEY}\\s*=`).test(line);

/** The env file sits beside the config, which is the repo root in dev and /data in the container. */
export const envFilePath = (configFile: string) =>
  process.env.ENV_FILE ?? path.join(path.dirname(path.resolve(configFile)), ".env");

/** Replaces the key line in place, or appends it. Every other line and comment survives. */
export function withKey(text: string, secret: string): string {
  const line = `${KEY}=${secret}`;
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : [];
  const at = lines.findIndex(isKeyLine);
  if (at === -1) lines.push(line);
  else {
    lines[at] = line;
    for (let i = lines.length - 1; i > at; i--) if (isKeyLine(lines[i])) lines.splice(i, 1);
  }
  return `${lines.join("\n")}\n`;
}

/** Backup first, then write through a temp file in the same directory so the swap is atomic. */
export async function writeEnvKey(file: string, secret: string) {
  let current = "";
  let existed = true;
  try {
    current = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    existed = false;
  }
  const text = withKey(current, secret);
  const backup = existed ? `${file}.bak` : null;
  if (backup) {
    await copyFile(file, backup);
    await chmod(backup, 0o600);
  }
  await writeFile(`${file}.tmp`, text, { mode: 0o600 });
  await chmod(`${file}.tmp`, 0o600);
  await rename(`${file}.tmp`, file);
  return { file, backup };
}
