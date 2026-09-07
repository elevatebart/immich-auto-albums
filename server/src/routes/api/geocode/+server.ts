import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { immichClient, PreviewError, readConfig } from '$lib/server/preview';
import type { GeoHit } from '$lib/types';
import type { RequestHandler } from './$types';

/** Immich's own geodata: place level, which is all a home needs, and nothing leaves the NAS. */
async function fromImmich(q: string): Promise<GeoHit[]> {
	if (!env.IMMICH_API_KEY) return [];
	const client = immichClient(await readConfig());
	const places = await client.api<
		{ name: string; latitude: number; longitude: number; admin1name?: string; admin2name?: string }[]
	>('GET', `/search/places?name=${encodeURIComponent(q)}`);
	return (places ?? []).slice(0, 8).map((p) => ({
		name: p.name,
		detail: [p.admin2name, p.admin1name].filter(Boolean).join(', '),
		lat: p.latitude,
		lon: p.longitude,
		source: 'immich' as const
	}));
}

/** Street level, but the query leaves the network. Set GEOCODER=immich to keep it off. */
async function fromNominatim(q: string): Promise<GeoHit[]> {
	if (env.GEOCODER === 'immich') return [];
	const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
	const res = await fetch(url, {
		headers: { 'user-agent': 'immich-auto-albums (https://github.com/elevatebart/immich-auto-albums)' }
	});
	if (!res.ok) throw new PreviewError(502, `nominatim: HTTP ${res.status}`);
	const hits = (await res.json()) as { display_name: string; name?: string; lat: string; lon: string }[];
	return hits.map((h) => ({
		name: h.name || h.display_name.split(',')[0],
		detail: h.display_name,
		lat: Number(h.lat),
		lon: Number(h.lon),
		source: 'nominatim' as const
	}));
}

/** Address to coordinates for the homes. Immich first, Nominatim only when it finds nothing. */
export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	if (q.length < 2) return json({ hits: [] });
	try {
		const hits = await fromImmich(q);
		return json({ hits: hits.length ? hits : await fromNominatim(q) });
	} catch (e) {
		const status = e instanceof PreviewError ? e.status : 500;
		return json({ error: (e as Error).message }, { status });
	}
};
