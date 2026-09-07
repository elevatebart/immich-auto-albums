import { writeFile } from "node:fs/promises";
import { configSchema } from "../src/schema.ts";

const path = new URL("../config.schema.json", import.meta.url);
await writeFile(path, JSON.stringify(configSchema, null, 2) + "\n");
console.log(`wrote ${path.pathname}`);
