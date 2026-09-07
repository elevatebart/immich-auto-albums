import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loadConfig } from '$core/config.js';
import { fixtureAssets } from '$lib/server/fixture';
import { configPath, immichClient, PreviewError } from '$lib/server/preview';
import type { RequestHandler } from './$types';

/** Named people, for the household and "me" pickers. Fixture names when there is no Immich. */
export const GET: RequestHandler = async () => {
	try {
		if (!env.IMMICH_API_KEY && env.DEMO === '1') {
			const names = new Set(fixtureAssets(new Date()).flatMap((a) => [...a.people]));
			return json({ source: 'fixture', people: [...names].sort().map((name) => ({ id: name, name })) });
		}
		const client = immichClient(await loadConfig(configPath()));
		const people = await client.fetchPeople();
		return json({
			source: 'immich',
			people: people.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))
		});
	} catch (e) {
		const status = e instanceof PreviewError ? e.status : 500;
		return json({ error: (e as Error).message }, { status });
	}
};
