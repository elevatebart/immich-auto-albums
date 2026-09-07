import { json } from '@sveltejs/kit';
import { fromToml, toToml } from '$core/config.js';
import { readConfigFile, validateConfig, warningsFor, writeConfigFile } from '$lib/server/config-io';
import { PreviewError } from '$lib/server/preview';
import type { ConfigWriteRequest } from '$lib/types';
import type { RequestHandler } from './$types';

const fail = (e: unknown) =>
	json({ error: (e as Error).message }, { status: e instanceof PreviewError ? e.status : 500 });

export const GET: RequestHandler = async () => {
	try {
		const { file, text, etag, config } = await readConfigFile();
		return json({ file, etag, config, toml: text });
	} catch (e) {
		return fail(e);
	}
};

/** Full replacement of config.toml. Needs the etag from GET; `dryRun` renders without writing. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as ConfigWriteRequest | null;
	if (typeof body?.etag !== 'string' || !body.etag) {
		return json({ error: 'etag is required; get it from GET /api/config' }, { status: 400 });
	}
	const { config, issues } = validateConfig(body.config);
	if (issues.length) {
		return json({ error: `${issues.length} invalid field(s)`, issues }, { status: 400 });
	}
	try {
		const current = await readConfigFile();
		const warnings = warningsFor(current.config, config);
		if (body.dryRun) {
			const toml = toToml(config);
			return json({ file: current.file, etag: current.etag, config, toml, warnings, dryRun: true });
		}
		const written = await writeConfigFile(config, body.etag);
		return json({
			file: written.file,
			etag: written.etag,
			config: fromToml(written.text),
			toml: written.text,
			warnings,
			backup: written.backup,
			dryRun: false
		});
	} catch (e) {
		return fail(e);
	}
};
