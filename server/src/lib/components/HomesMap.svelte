<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { Map as LMap, LayerGroup, Marker } from 'leaflet';
	import type { Home } from '$core/types.js';
	import { Text } from '@immich/ui';
	import 'leaflet/dist/leaflet.css';

	let { homes = $bindable(), selected = $bindable(-1) }: { homes: Home[]; selected?: number } =
		$props();

	let el: HTMLDivElement;
	let map: LMap | null = null;
	let layer: LayerGroup | null = null;
	let lib: typeof import('leaflet') | null = null;

	onMount(() => void init());
	onDestroy(() => map?.remove());

	async function init() {
		lib = await import('leaflet');
		map = lib.map(el, { scrollWheelZoom: false }).setView([46.5, 4], 4);
		lib
			.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '(c) OpenStreetMap contributors',
				maxZoom: 18
			})
			.addTo(map);
		layer = lib.layerGroup().addTo(map);
		draw();
		fit();
	}

	/** Redraws on add and remove only, so a drag is not interrupted by its own state write. */
	$effect(() => {
		homes.length;
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

	function fit() {
		if (!lib || !map || !homes.length) return;
		map.fitBounds(lib.latLngBounds(homes.map((h) => [h.lat, h.lon])).pad(0.3));
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
