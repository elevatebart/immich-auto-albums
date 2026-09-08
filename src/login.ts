import {
  UNTESTED_PERMISSIONS,
  authMessage,
  createApiKey,
  signIn,
  signOut,
  sweepSessions,
  verifyCredential,
} from "./auth.js";
import { envFilePath, writeEnvKey } from "./env-file.js";
import { normalizeUrl } from "./immich.js";
import { ask, askSecret } from "./prompt.js";

interface Options {
  configFile: string;
  defaultUrl: string;
  save: boolean;
}

/** Signs in, mints a key scoped to what the planner needs, and prints it. Exit code for the CLI. */
export async function runLogin(opts: Options): Promise<number> {
  let url = "";
  try {
    url = normalizeUrl(await ask("Immich URL", opts.defaultUrl));
    const email = await ask("Email");
    const password = await askSecret("Password");
    console.log("");

    const session = await signIn(url, email, password);
    console.log(`Signed in as ${session.email}.`);
    const swept = await sweepSessions(url, session.token);
    if (swept) console.log(`Cleaned up ${swept} leftover session${swept > 1 ? "s" : ""}.`);

    const name = `immich-auto-albums ${new Date().toISOString().slice(0, 10)}`;
    const secret = await createApiKey(url, session.token, name);
    const verified = await verifyCredential(url, { kind: "key", value: secret });
    await signOut(url, session);

    console.log(`\nKey "${name}" can:`);
    for (const c of verified.checks) console.log(`  ${c.ok ? "yes" : "NO "}  ${c.label} (${c.permission})`);
    console.log(`  granted, not tested: ${UNTESTED_PERMISSIONS.join(", ")}`);
    console.log(`\nIMMICH_API_KEY=${secret}\n`);

    if (!verified.ok) {
      console.error("The key was rejected by one of the checks above, so nothing was written.");
      return 1;
    }
    if (!opts.save) {
      console.log(`Put that line in ${envFilePath(opts.configFile)}, or run again with --save.`);
      return 0;
    }
    const written = await writeEnvKey(envFilePath(opts.configFile), secret);
    console.log(`Wrote ${written.file}${written.backup ? ` (previous text in ${written.backup})` : ""}.`);
    return 0;
  } catch (e) {
    console.error(url ? authMessage(url, e) : (e as Error).message);
    return 1;
  }
}
