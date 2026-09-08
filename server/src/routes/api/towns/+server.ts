import { json } from '@sveltejs/kit';
import { PreviewError, townsNear } from '$lib/server/preview';
import type { RequestHandler } from './$types';

const num = (v: string | null) => (v === null || v === '' ? NaN : Number(v));

/** Towns around a zone circle, so the map can show what it catches and what it just misses. */
export const GET: RequestHandler = async ({ url }) => {
	const lat = num(url.searchParams.get('lat'));
	const lon = num(url.searchParams.get('lon'));
	const km = num(url.searchParams.get('km'));
	if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(km)) {
		return json({ error: 'lat, lon and km are required' }, { status: 400 });
	}
	try {
		return json({ towns: await townsNear(lat, lon, Math.min(Math.max(km, 1), 200)) });
	} catch (e) {
		const status = e instanceof PreviewError ? e.status : 500;
		return json({ error: (e as Error).message }, { status });
	}
};
