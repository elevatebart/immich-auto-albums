/** Shared Leaflet setup. Imported dynamically so nothing touches window during SSR. */
const TILES = {
	osm: {
		url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
		attribution: '(c) OpenStreetMap contributors',
		maxZoom: 18
	},
	// Relief and contours, which is the only way to tell a summit from the valley below it.
	topo: {
		url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
		attribution: '(c) OpenStreetMap, SRTM | (c) OpenTopoMap (CC-BY-SA)',
		maxZoom: 17
	}
};

export async function createMap(
	el: HTMLElement,
	view: [number, number] = [46.5, 4],
	zoom = 4,
	tiles: keyof typeof TILES = 'osm'
) {
	const lib = await import('leaflet');
	const map = lib.map(el, { scrollWheelZoom: false }).setView(view, zoom);
	lib.tileLayer(TILES[tiles].url, TILES[tiles]).addTo(map);
	return { lib, map };
}

/** Leaflet fits to zoom 0 while its container has no size, so wait for a real one. */
export function whenSized(el: HTMLElement, run: () => void) {
	const ro = new ResizeObserver(() => {
		if (el.clientWidth > 0) run();
	});
	ro.observe(el);
	return () => ro.disconnect();
}
