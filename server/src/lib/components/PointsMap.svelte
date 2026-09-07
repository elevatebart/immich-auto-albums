<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { LayerGroup, Map as LMap } from 'leaflet';
	import { createMap, whenSized } from '$lib/leaflet';
	import 'leaflet/dist/leaflet.css';

	interface Props {
		/** Where the album's photos were taken. */
		points: { lat: number; lon: number }[];
		class?: string;
	}

	let { points, class: className = 'h-56' }: Props = $props();

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

	$effect(() => {
		points.length;
		needsFit = true;
		draw();
	});

	function draw() {
		if (!lib || !layer) return;
		layer.clearLayers();
		for (const p of points) {
			layer.addLayer(lib.circleMarker([p.lat, p.lon], { radius: 4, weight: 1, className: 'photo-dot' }));
		}
		fit();
	}

	function fit() {
		if (!lib || !map) return;
		map.invalidateSize();
		if (!needsFit || !points.length || !map.getSize().x) return;
		map.fitBounds(lib.latLngBounds(points.map((p) => [p.lat, p.lon])).pad(0.25), {
			maxZoom: 13,
			animate: false
		});
		needsFit = false;
	}
</script>

<div class="border-subtle w-full rounded-xl border {className}" bind:this={el}></div>
