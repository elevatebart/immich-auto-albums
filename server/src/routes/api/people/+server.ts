import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { fixtureAssets } from '$lib/server/fixture';
import { credential } from '$lib/server/credentials';
import { immichClient, PreviewError, readConfig } from '$lib/server/preview';
import type { RequestHandler } from './$types';

/** Named people, for the household and "me" pickers. Fixture names when there is no Immich. */
export const GET: RequestHandler = async () => {
	try {
		const cfg = await readConfig();
		if (!credential() && env.DEMO === '1') {
			const names = new Set(fixtureAssets(new Date(), cfg).flatMap((a) => [...a.people]));
			return json({ source: 'fixture', people: [...names].sort().map((name) => ({ id: name, name })) });
		}
		const client = immichClient(cfg);
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
