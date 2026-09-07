<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { CircleMarker, LayerGroup, Map as LMap } from 'leaflet';
	import { HStack, Text } from '@immich/ui';
	import { createMap, whenSized } from '$lib/leaflet';
	import type { PreviewRow } from '$lib/types';
	import 'leaflet/dist/leaflet.css';

	interface Props {
		/** The rows on screen, so the map follows the table filters. */
		rows: PreviewRow[];
		focused?: string;
	}

	let { rows, focused = $bindable() }: Props = $props();

	let el: HTMLDivElement;
	let map: LMap | null = null;
	let layer: LayerGroup | null = null;
	let lib: typeof import('leaflet') | null = null;
	let markers = new Map<string, CircleMarker>();
	let needsFit = true;
	let unsize: (() => void) | null = null;

	const located = $derived(rows.filter((r) => r.centroid));

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
		located;
		needsFit = true;
		draw();
	});

	/** Focus is a class swap and a pan, never a redraw, so clicking a row keeps the zoom. */
	$effect(() => {
		for (const [id, m] of markers) {
			m.getElement()?.classList.toggle('centroid-focused', id === focused);
		}
		const hit = focused ? located.find((r) => r.id === focused) : undefined;
		if (hit?.centroid && map) map.panTo([hit.centroid.lat, hit.centroid.lon]);
	});

	function draw() {
		if (!lib || !layer || !map) return;
		layer.clearLayers();
		markers = new Map();
		for (const r of located) {
			const c = r.centroid!;
			const m = lib
				.circleMarker([c.lat, c.lon], {
					radius: Math.min(24, 5 + Math.sqrt(r.assets)),
					weight: 2,
					className: `centroid centroid-${r.op}`
				})
				.bindTooltip(`${r.name}, ${r.assets} photos, ${r.op}`)
				.on('click', () => (focused = r.id));
			layer.addLayer(m);
			markers.set(r.id, m);
		}
		fit();
	}

	/** Fits once per data change, so a click or a pan is not undone by a resize. */
	function fit() {
		if (!lib || !map) return;
		map.invalidateSize();
		if (!needsFit || !located.length || !map.getSize().x) return;
		map.fitBounds(lib.latLngBounds(located.map((r) => [r.centroid!.lat, r.centroid!.lon])).pad(0.3), {
			maxZoom: 11,
			animate: false
		});
		needsFit = false;
	}
</script>

{#snippet swatch(color: string, label: string)}
	<HStack gap={1}>
		<span class="size-3 rounded-full opacity-60" style="background: var({color})"></span>
		<Text color="muted" size="tiny">{label}</Text>
	</HStack>
{/snippet}

<div class="flex flex-col gap-1">
	<div class="border-subtle h-64 w-full rounded-xl border sm:h-80" bind:this={el}></div>
	{#if located.length}
		<HStack gap={3} class="flex-wrap">
			{@render swatch('--immich-ui-success-500', 'create')}
			{@render swatch('--immich-ui-warning-500', 'update')}
			{@render swatch('--immich-ui-light-500', 'unchanged')}
		</HStack>
	{/if}
	<Text color="muted" size="small">
		{#if located.length}
			{located.length} of {rows.length} rows have a centroid, sized by photo count. Person years and
			seasons have no location. Click a circle to find its row.
		{:else}
			None of the rows on screen have GPS, so there is nothing to place on the map.
		{/if}
	</Text>
</div>
