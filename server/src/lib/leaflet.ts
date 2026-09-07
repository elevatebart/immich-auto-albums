/** Shared Leaflet setup. Imported dynamically so nothing touches window during SSR. */
export async function createMap(el: HTMLElement, view: [number, number] = [46.5, 4], zoom = 4) {
	const lib = await import('leaflet');
	const map = lib.map(el, { scrollWheelZoom: false }).setView(view, zoom);
	lib
		.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '(c) OpenStreetMap contributors',
			maxZoom: 18
		})
		.addTo(map);
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
