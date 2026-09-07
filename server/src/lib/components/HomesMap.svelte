<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { Map as LMap, LayerGroup, Marker } from 'leaflet';
	import type { Home } from '$core/types.js';
	import { Text } from '@immich/ui';
	import { createMap, whenSized } from '$lib/leaflet';
	import 'leaflet/dist/leaflet.css';

	let { homes = $bindable(), selected = $bindable(-1) }: { homes: Home[]; selected?: number } =
		$props();

	let el: HTMLDivElement;
	let map: LMap | null = null;
	let layer: LayerGroup | null = null;
	let lib: typeof import('leaflet') | null = null;
	let needsFit = true;
	let unsize: (() => void) | null = null;

	onMount(() => void init());
	onDestroy(() => {
		unsize?.();
		map?.remove();
	});

	async function init() {
		({ lib, map } = await createMap(el));
		layer = lib.layerGroup().addTo(map);
		unsize = whenSized(el, fit);
		draw();
	}

	/** Redraws on add and remove only, so a drag is not interrupted by its own state write. */
	$effect(() => {
		homes.length;
		needsFit = true;
		untrack(() => draw());
	});

	function draw() {
		if (!lib || !layer) return;
		layer.clearLayers();
		homes.forEach((h, i) => {
			const m: Marker = lib!
				.marker([h.lat, h.lon], {
					draggable: true,
					icon: lib!.divIcon({ className: 'home-pin', iconSize: [14, 14] })
				})
				.bindTooltip(`${h.label || 'home'}, from ${h.from}`)
				.on('dragend', () => {
					const p = m.getLatLng();
					homes[i].lat = Number(p.lat.toFixed(5));
					homes[i].lon = Number(p.lng.toFixed(5));
				})
				.on('click', () => (selected = i));
			layer!.addLayer(m);
		});
	}

	/** Fits once per add or remove, so dragging a pin does not move the view. */
	function fit() {
		if (!lib || !map) return;
		map.invalidateSize();
		if (!needsFit || !homes.length || !map.getSize().x) return;
		map.fitBounds(lib.latLngBounds(homes.map((h) => [h.lat, h.lon])).pad(0.3), {
			maxZoom: 12,
			animate: false
		});
		needsFit = false;
	}

	export function addAtCenter(): Home {
		const c = map?.getCenter();
		return { from: new Date().toISOString().slice(0, 10), lat: Number((c?.lat ?? 46.5).toFixed(5)), lon: Number((c?.lng ?? 4).toFixed(5)), label: '' };
	}
</script>

<div class="border-subtle h-72 w-full rounded-xl border" bind:this={el}></div>
<Text color="muted" size="small" class="pt-1">
	Drag a pin to move a home. The map recentres when a home is added or removed.
</Text>
