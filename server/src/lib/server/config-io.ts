import { createHash } from 'node:crypto';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { fromToml, toToml } from '$core/config.js';
import type { Config } from '$core/types.js';
import { configPath, invalidate, PreviewError } from './preview';

export { validateConfig } from '$core/validate.js';
export type { ConfigIssue } from '$core/schema.js';

export const etagOf = (text: string) =>
	createHash('sha256').update(text).digest('hex').slice(0, 16);

export async function readConfigFile() {
	const file = configPath();
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (e) {
		const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
		throw new PreviewError(missing ? 404 : 500, `cannot read ${file}: ${(e as Error).message}`);
	}
	try {
		return { file, text, etag: etagOf(text), config: fromToml(text) };
	} catch (e) {
		throw new PreviewError(500, `${file} is not valid: ${(e as Error).message}`);
	}
}

/** Backup first, then write through a temp file in the same directory so the swap is atomic. */
export async function writeConfigFile(next: Config, etag: string) {
	const current = await readConfigFile();
	if (etag !== current.etag) {
		throw new PreviewError(409, 'config.toml changed on disk since you loaded it. Reload, then edit again.');
	}
	const text = toToml(next);
	await copyFile(current.file, `${current.file}.bak`);
	await writeFile(`${current.file}.tmp`, text);
	await rename(`${current.file}.tmp`, current.file);
	invalidate();
	return { file: current.file, text, etag: etagOf(text), backup: `${current.file}.bak` };
}

/** Changes that are legal but cost the user something, so the UI can say so before the write. */
export function warningsFor(current: Config, next: Config): string[] {
	const out: string[] = [];
	if (current.immich.marker !== next.immich.marker) {
		out.push(
			`Changing the marker to ${next.immich.marker} orphans the albums tagged ${current.immich.marker}: they stop being found, and the next apply creates new ones.`
		);
	}
	if (next.immich.windowDays < current.immich.windowDays) {
		out.push(
			`The window shrinks from ${current.immich.windowDays} to ${next.immich.windowDays} days, so trips and gatherings before that fall out of the plan. Existing albums are left alone.`
		);
	}
	return out;
}
