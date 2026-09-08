<script lang="ts">
	import { onDestroy } from 'svelte';
	import { mdiDelete, mdiMapMarkerRadiusOutline, mdiPlus } from '@mdi/js';
	import type { Circle, LayerGroup, Map as LMap, Marker } from 'leaflet';
	import {
		Button,
		Field,
		HStack,
		IconButton,
		Input,
		Modal,
		ModalBody,
		ModalFooter,
		NumberInput,
		Stack,
		Text
	} from '@immich/ui';
	import type { Zone } from '$core/types.js';
	import { createMap, whenSized } from '$lib/leaflet';
	import type { Town } from '$lib/types';
	import 'leaflet/dist/leaflet.css';

	interface Props {
		/** The config entries carrying this name. They are one area: a trip inside any circle counts. */
		circles: Zone[];
		onRename: (name: string) => void;
		onAdd: () => void;
		onRemove: (circle: Zone) => void;
		onClose: () => void;
	}

	let { circles, onRename, onAdd, onRemove, onClose }: Props = $props();

	let el = $state<HTMLDivElement | null>(null);
	let map: LMap | null = null;
	let layer: LayerGroup | null = null;
	let lib: typeof import('leaflet') | null = null;
	let unsize: (() => void) | null = null;
	let starting = false;
	let towns = $state<Town[]>([]);
	let loading = $state(false);
	let fitted = false;

	const name = $derived(circles[0]?.name ?? '');
	const inside = (t: Town) =>
		circles.some((z) => distanceKm(t.lat, t.lon, z.lat, z.lon) <= z.km);
	const caught = $derived(towns.filter(inside));
	const missed = $derived(towns.filter((t) => !inside(t)));

	/** Same formula as the planner, so the list matches what a run would do. */
	function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
		const r = Math.PI / 180;
		const a =
			Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
			Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
		return 12742 * Math.asin(Math.sqrt(a));
	}

	onDestroy(() => {
		unsize?.();
		map?.remove();
	});

	// The modal mounts its body after this component, so wait for the container to exist.
	$effect(() => {
		if (el && !map && !starting) void init(el);
	});

	async function init(box: HTMLDivElement) {
		starting = true;
		const first = circles[0];
		({ lib, map } = await createMap(box, [first?.lat ?? 45.19, first?.lon ?? 5.72], 11, 'topo'));
		layer = lib.layerGroup().addTo(map);
		unsize = whenSized(box, () => {
			map?.invalidateSize();
			fit();
		});
		draw();
	}

	// Redraws on every number change, so typing a radius moves the circle on the map.
	$effect(() => {
		circles.map((z) => `${z.lat},${z.lon},${z.km}`).join('|');
		draw();
		loadTowns();
	});

	function draw() {
		if (!lib || !layer) return;
		layer.clearLayers();
		for (const z of circles) {
			const shape: Circle = lib.circle([z.lat, z.lon], { radius: z.km * 1000, className: 'zone-ring' });
			layer.addLayer(shape);
			const handle: Marker = lib.marker([z.lat, z.lon], {
				draggable: true,
				icon: lib.divIcon({ className: 'zone-handle', iconSize: [14, 14] })
			});
			handle.on('drag', () => {
				const p = handle.getLatLng();
				z.lat = Number(p.lat.toFixed(5));
				z.lon = Number(p.lng.toFixed(5));
			});
			layer.addLayer(handle);
		}
		for (const t of towns) {
			const hit = inside(t);
			layer.addLayer(
				lib
					.circleMarker([t.lat, t.lon], {
						radius: 4 + Math.min(6, Math.log2(t.photos + 1)),
						className: hit ? 'town-in' : 'town-out'
					})
					.bindTooltip(`${t.name}, ${t.photos} photos${t.district ? ` (${t.district})` : ''}`)
			);
		}
		fit();
	}

	/** Fits once, on the first draw that has both a size and a circle. */
	function fit() {
		if (!lib || !map || fitted || !circles.length || !map.getSize().x) return;
		const bounds = lib.latLngBounds(circles.map((z) => [z.lat, z.lon] as [number, number]));
		map.fitBounds(bounds.pad(0.6), { maxZoom: 12, animate: false });
		fitted = true;
	}

	async function loadTowns() {
		if (!circles.length || loading) return;
		const lat = circles.reduce((s, z) => s + z.lat, 0) / circles.length;
		const lon = circles.reduce((s, z) => s + z.lon, 0) / circles.length;
		const reach = Math.max(...circles.map((z) => z.km + distanceKm(lat, lon, z.lat, z.lon))) + 15;
		loading = true;
		try {
			const res = await fetch(`/api/towns?lat=${lat}&lon=${lon}&km=${reach.toFixed(1)}`);
			const body = await res.json();
			if (res.ok) towns = body.towns as Town[];
		} finally {
			loading = false;
			draw();
		}
	}
</script>

<Modal title={name || 'Zone'} icon={mdiMapMarkerRadiusOutline} size="giant" closeOnBackdropClick {onClose}>
	<ModalBody>
		<Stack gap={3} class="w-[min(88vw,58rem)]">
			<Field label="Name" description="Used as the album name when a trip stays inside these circles.">
				<Input value={name} oninput={(e) => onRename(e.currentTarget.value)} />
			</Field>

			<div class="border-subtle w-full rounded-xl border" style="height: 24rem" bind:this={el}></div>
			<Text color="muted" size="tiny">
				Drag a marker to move a circle. Dots are towns in the snapshot, sized by photo count.
			</Text>

			<div class="overflow-x-auto">
				<table class="w-full min-w-[26rem] text-sm">
					<thead class="text-primary">
						<tr class="border-subtle border-b text-left">
							<th class="py-1 pe-2 font-medium">Latitude</th>
							<th class="py-1 pe-2 font-medium">Longitude</th>
							<th class="py-1 pe-2 font-medium">Radius (km)</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each circles as circle, i (i)}
							<tr class="border-subtle border-b">
								<td class="py-1 pe-2">
									<NumberInput size="small" step={0.00001} bind:value={circle.lat} />
								</td>
								<td class="py-1 pe-2">
									<NumberInput size="small" step={0.00001} bind:value={circle.lon} />
								</td>
								<td class="py-1 pe-2">
									<NumberInput size="small" step={0.5} min={0.1} bind:value={circle.km} />
								</td>
								<td class="py-1">
									<IconButton
										icon={mdiDelete}
										variant="ghost"
										color="danger"
										size="small"
										aria-label="remove circle"
										disabled={circles.length < 2}
										onclick={() => onRemove(circle)}
									/>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div>
				<Button variant="outline" size="tiny" leadingIcon={mdiPlus} onclick={onAdd}>Add circle</Button>
			</div>

			{#if towns.length}
				<Stack gap={1}>
					<Text size="small">Inside: {caught.map((t) => `${t.name} (${t.photos})`).join(', ') || 'nothing yet'}</Text>
					<Text color="muted" size="small">
						Just outside: {missed.slice(0, 12).map((t) => `${t.name} (${t.photos})`).join(', ')}
					</Text>
				</Stack>
			{:else if loading}
				<Text color="muted" size="small">Reading the towns nearby...</Text>
			{/if}
		</Stack>
	</ModalBody>
	<ModalFooter>
		<Text color="muted" size="small">
			{circles.length} circle{circles.length === 1 ? '' : 's'}, {caught.length} towns inside. Save the
			config to keep the change.
		</Text>
	</ModalFooter>
</Modal>
