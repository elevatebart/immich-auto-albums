const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACE = ["\u007f", "\b"];

/** Whatever arrived after the last Enter, so a paste of several lines is not swallowed. */
let pending = "";

/** Raw mode throughout, so the password prompt and the visible ones behave the same way. */
function readLine(label: string, echo: boolean): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("no terminal here: set IMMICH_API_KEY in the environment instead");
  process.stdout.write(label);
  return new Promise((resolve) => {
    let out = "";
    const finish = () => {
      process.stdout.write("\n");
      resolve(out);
    };
    /** Returns true once the line is complete, leaving the rest of the chunk in `pending`. */
    const eat = (chunk: string): boolean => {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (ch === "\r" || ch === "\n" || (ch === CTRL_D && !out)) {
          pending = chunk.slice(i + 1);
          return true;
        }
        if (ch === CTRL_C) {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (BACKSPACE.includes(ch)) {
          if (out.length) {
            out = out.slice(0, -1);
            if (echo) process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch < " ") continue;
        out += ch;
        if (echo) process.stdout.write(ch);
      }
      return false;
    };

    const buffered = pending;
    pending = "";
    if (buffered && eat(buffered)) return finish();

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      if (!eat(chunk)) return;
      stdin.off("data", onData);
      stdin.pause();
      stdin.setRawMode(wasRaw);
      finish();
    };
    stdin.on("data", onData);
  });
}

export async function ask(label: string, fallback = ""): Promise<string> {
  const answer = (await readLine(fallback ? `${label} [${fallback}]: ` : `${label}: `, true)).trim();
  return answer || fallback;
}

export const askSecret = (label: string) => readLine(`${label}: `, false);
