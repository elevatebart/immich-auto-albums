<script lang="ts">
	import { mdiDelete, mdiMapMarkerRadiusOutline, mdiPlus } from '@mdi/js';
	import {
		Alert,
		Button,
		Card,
		CardBody,
		CardDescription,
		CardHeader,
		CardTitle,
		Field,
		HStack,
		HelperText,
		IconButton,
		Input,
		Label,
		NumberInput,
		Select,
		Stack,
		Text
	} from '@immich/ui';
	import { schemaField, type ConfigIssue } from '$core/schema.js';
	import type { Config, Zone } from '$core/types.js';
	import AddressLookup from '$lib/components/AddressLookup.svelte';
	import PeoplePicker from '$lib/components/PeoplePicker.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import ZoneModal from '$lib/components/ZoneModal.svelte';
	import type { Person } from '$lib/types';

	interface Props {
		config: Config;
		/** Aliases are edited as rows so an empty key can exist while typing. */
		aliasRows: { from: string; to: string }[];
		issues: ConfigIssue[];
		people: Person[];
		peopleNote: string;
		toml: string;
	}

	let {
		config = $bindable(),
		aliasRows = $bindable(),
		issues,
		people,
		peopleNote,
		toml
	}: Props = $props();

	let showToml = $state(false);

	const today = () => new Date().toISOString().slice(0, 10);
	const iss = (field: string) => issues.find((i) => i.field === field)?.message;
	const hint = (field: string) => schemaField(field).description;

	const sortHomes = () => config.homes.sort((a, b) => a.from.localeCompare(b.from));
	const outOfOrder = $derived(config.homes.some((h, i, all) => i > 0 && h.from < all[i - 1].from));
	const rowLabel = (h: { label?: string; from: string }, i: number) =>
		h.label?.trim() || `row ${i + 1} (${h.from})`;

	const addHome = () =>
		config.homes.push({
			from: today(),
			lat: config.homes.at(-1)?.lat ?? 46.5,
			lon: config.homes.at(-1)?.lon ?? 4
		});

	let openZone = $state<string | null>(null);

	/** Entries sharing a name are one zone, so the form lists them grouped and edits them together. */
	const zoneGroups = $derived(
		[...new Set(config.zones.map((z) => z.name))].map((name) => ({
			name,
			circles: config.zones.filter((z) => z.name === name)
		}))
	);
	const shown = $derived(zoneGroups.find((g) => g.name === openZone));

	function addZone() {
		const home = config.homes.at(-1);
		const name = `Zone ${zoneGroups.length + 1}`;
		config.zones.push({ name, lat: home?.lat ?? 46.5, lon: home?.lon ?? 4, km: 10 });
		openZone = name;
	}

	function addCircle(name: string) {
		const last = config.zones.filter((z) => z.name === name).at(-1);
		config.zones.push({ name, lat: last?.lat ?? 46.5, lon: last?.lon ?? 4, km: last?.km ?? 10 });
	}

	function renameZone(from: string, to: string) {
		for (const z of config.zones) if (z.name === from) z.name = to;
		openZone = to;
	}

	const removeCircle = (circle: Zone) => {
		const at = config.zones.indexOf(circle);
		if (at >= 0) config.zones.splice(at, 1);
	};

	function removeZone(name: string) {
		config.zones = config.zones.filter((z) => z.name !== name);
		if (openZone === name) openZone = null;
	}

	/** A found place either starts a new home or replaces the coordinates of one. */
	function place(hit: { name: string; lat: number; lon: number }, target: number) {
		// 5 decimals is a metre, and the home radius is kilometres.
		const [lat, lon] = [Number(hit.lat.toFixed(5)), Number(hit.lon.toFixed(5))];
		if (target < 0) {
			config.homes.push({ from: today(), lat, lon, label: hit.name });
			return;
		}
		const home = config.homes[target];
		if (!home) return;
		home.lat = lat;
		home.lon = lon;
		home.label ||= hit.name;
	}
</script>

<Stack gap={4}>
	<Card>
		<CardHeader>
			<CardTitle>Immich</CardTitle>
			<CardDescription>
				No credential is ever stored here: it comes from signing in, or from IMMICH_API_KEY.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={4}>
				<Field label="Server URL" invalid={!!iss('immich.url')}>
					<Input bind:value={config.immich.url} placeholder="http://nas:2283" />
					{#if iss('immich.url')}<HelperText color="danger">{iss('immich.url')}</HelperText>{/if}
				</Field>
				<Field label="Output directory" description={hint('immich.outDir')}>
					<Input bind:value={config.immich.outDir} />
				</Field>
				<Field
					label="Album marker"
					description={hint('immich.marker')}
					invalid={!!iss('immich.marker')}
				>
					<Input bind:value={config.immich.marker} />
				</Field>
				<Slider
					label="Recompute window"
					field="immich.windowDays"
					bind:value={config.immich.windowDays}
					unit="days"
					{issues}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>People</CardTitle>
			<CardDescription>{peopleNote}</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={4}>
				<PeoplePicker
					label="Me"
					description={hint('people.me')}
					{people}
					selected={config.people.me ? [config.people.me] : []}
					multiple={false}
					onchange={(names) => (config.people.me = names[0] ?? '')}
				/>
				{#if iss('people.me')}<Text color="danger" size="small">{iss('people.me')}</Text>{/if}
				<PeoplePicker
					label="Household"
					description={hint('people.household')}
					{people}
					selected={config.people.household}
					onchange={(names) => (config.people.household = names)}
				/>
				<Slider
					label="Guest share of tagged photos"
					field="people.withShare"
					bind:value={config.people.withShare}
					step={0.05}
					{issues}
				/>
				<Slider
					label="Minimum tagged photos"
					field="people.withMinTagged"
					bind:value={config.people.withMinTagged}
					{issues}
				/>
				<Slider
					label="Maximum names in a title"
					field="people.maxNamed"
					bind:value={config.people.maxNamed}
					{issues}
				/>
				<div>
					<Label label="Places that never get names" size="small" />
					<Text color="muted" size="small" class="mb-2">{hint('people.noPeoplePlaces')}</Text>
					<Stack gap={1}>
						{#each config.people.noPeoplePlaces as _, i (i)}
							<HStack gap={2}>
								<Input bind:value={config.people.noPeoplePlaces[i]} />
								<IconButton
									icon={mdiDelete}
									variant="ghost"
									color="danger"
									size="small"
									aria-label="remove place"
									onclick={() => config.people.noPeoplePlaces.splice(i, 1)}
								/>
							</HStack>
						{/each}
						<div>
							<Button
								variant="outline"
								size="tiny"
								leadingIcon={mdiPlus}
								onclick={() => config.people.noPeoplePlaces.push('')}
							>
								Add place
							</Button>
						</div>
					</Stack>
				</div>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Homes</CardTitle>
			<CardDescription>
				Each home applies until the next one starts, so they must stay in date order. Photos within
				the home radius are home, everything else is a trip.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={3}>
				<AddressLookup targets={config.homes.map(rowLabel)} onpick={place} />
				{#if outOfOrder}
					<Alert color="warning" title="Out of order">
						Homes must run oldest first.
						<Button variant="outline" size="tiny" class="mt-2" onclick={sortHomes}>
							Sort by date
						</Button>
					</Alert>
				{/if}
				<div class="overflow-x-auto">
				<table class="w-full min-w-[26rem] text-sm">
					<thead class="text-primary">
						<tr class="border-subtle border-b text-left">
							<th class="py-1 pe-2 font-medium">Label</th>
							<th class="py-1 pe-2 font-medium">From</th>
							<th class="py-1 pe-2 font-medium">Latitude</th>
							<th class="py-1 pe-2 font-medium">Longitude</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each config.homes as home, i (i)}
							<tr class="border-subtle border-b">
								<td class="py-1 pe-2">
									<Input size="small" bind:value={home.label} placeholder="optional" />
								</td>
								<td class="py-1 pe-2">
									<Input type="date" size="small" bind:value={home.from} />
								</td>
								<td class="py-1 pe-2">
									<NumberInput size="small" step={0.00001} bind:value={home.lat} />
								</td>
								<td class="py-1 pe-2">
									<NumberInput size="small" step={0.00001} bind:value={home.lon} />
								</td>
								<td class="py-1">
									<IconButton
										icon={mdiDelete}
										variant="ghost"
										color="danger"
										size="small"
										aria-label="remove home"
										disabled={config.homes.length < 2}
										onclick={() => config.homes.splice(i, 1)}
									/>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				</div>
				<div>
					<Button variant="outline" size="tiny" leadingIcon={mdiPlus} onclick={addHome}>
						Add empty home
					</Button>
				</div>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Zones</CardTitle>
			<CardDescription>
				A named area beats the district in an album name. Circles sharing a name are one zone, which
				is how a mountain range can be covered without dragging in the valley between its resorts.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={3}>
				{#if !config.zones.length}
					<Text color="muted" size="small">No zones. Trips fall back to the district or the region.</Text>
				{/if}
				{#each zoneGroups as group (group.name)}
					<HStack gap={2} class="border-subtle flex-wrap justify-between border-b pb-2">
						<Stack gap={0}>
							<Text size="small">{group.name}</Text>
							<Text color="muted" size="tiny">
								{group.circles.length} circle{group.circles.length === 1 ? '' : 's'}, {group.circles
									.map((z) => `${z.km} km`)
									.join(' + ')}
							</Text>
						</Stack>
						<HStack gap={1}>
							<Button
								variant="outline"
								size="tiny"
								leadingIcon={mdiMapMarkerRadiusOutline}
								onclick={() => (openZone = group.name)}
							>
								Map
							</Button>
							<IconButton
								icon={mdiDelete}
								variant="ghost"
								color="danger"
								size="small"
								aria-label="remove zone"
								onclick={() => removeZone(group.name)}
							/>
						</HStack>
					</HStack>
				{/each}
				<div>
					<Button variant="outline" size="tiny" leadingIcon={mdiPlus} onclick={addZone}>Add zone</Button>
				</div>
				<Slider
					label="Zone share"
					field="clustering.zoneShare"
					bind:value={config.clustering.zoneShare}
					{issues}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Clustering</CardTitle>
			<CardDescription>
				What counts as a trip, a day trip or a gathering. Check the preview after moving these.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={2}>
				<Slider
					label="Home radius"
					field="clustering.homeKm"
					bind:value={config.clustering.homeKm}
					step={0.5}
					unit="km"
					{issues}
				/>
				<Slider
					label="Place radius"
					field="clustering.placeKm"
					bind:value={config.clustering.placeKm}
					step={0.5}
					unit="km"
					{issues}
				/>
				<Slider
					label="Place radius cap"
					field="clustering.placeKmMax"
					bind:value={config.clustering.placeKmMax}
					step={0.5}
					unit="km"
					{issues}
				/>
				<Slider
					label="Label merge radius"
					field="clustering.mergeLabelKm"
					bind:value={config.clustering.mergeLabelKm}
					step={0.5}
					unit="km"
					{issues}
				/>
				<Slider
					label="Dominant place share"
					field="clustering.dominantShare"
					bind:value={config.clustering.dominantShare}
					step={0.05}
					{issues}
				/>
				<Slider
					label="Trip gap"
					field="clustering.tripGapHours"
					bind:value={config.clustering.tripGapHours}
					unit="hours"
					{issues}
				/>
				<Slider
					label="Trip minimum photos"
					field="clustering.tripMinPhotos"
					bind:value={config.clustering.tripMinPhotos}
					{issues}
				/>
				<Slider
					label="Trip minimum days"
					field="clustering.tripMinDays"
					bind:value={config.clustering.tripMinDays}
					{issues}
				/>
				<Slider
					label="Day trip minimum photos"
					field="clustering.daytripMinPhotos"
					bind:value={config.clustering.daytripMinPhotos}
					{issues}
				/>
				<Slider
					label="Gathering gap"
					field="clustering.gatherGapHours"
					bind:value={config.clustering.gatherGapHours}
					step={0.5}
					unit="hours"
					{issues}
				/>
				<Slider
					label="Gathering minimum photos"
					field="clustering.gatherMinPhotos"
					bind:value={config.clustering.gatherMinPhotos}
					{issues}
				/>
				<Slider
					label="Gathering minimum guests"
					field="clustering.gatherMinGuests"
					bind:value={config.clustering.gatherMinGuests}
					{issues}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Person years and seasons</CardTitle>
		</CardHeader>
		<CardBody>
			<Stack gap={2}>
				<Slider
					label="Person year minimum photos"
					field="personYears.minPhotos"
					bind:value={config.personYears.minPhotos}
					{issues}
				/>
				<Slider
					label="Household minimum photos"
					field="personYears.householdMinPhotos"
					bind:value={config.personYears.householdMinPhotos}
					{issues}
				/>
				<Field
					label="GPS-less era ends"
					description={hint('seasons.noGpsEraEnd')}
					invalid={!!iss('seasons.noGpsEraEnd')}
				>
					<Input type="date" bind:value={config.seasons.noGpsEraEnd} />
				</Field>
				<Slider
					label="Season minimum photos"
					field="seasons.minPhotos"
					bind:value={config.seasons.minPhotos}
					{issues}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Place aliases</CardTitle>
			<CardDescription>
				Geocoder label on the left, the name used in albums on the right.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={1}>
				{#each aliasRows as row, i (i)}
					<HStack gap={2}>
						<Input size="small" bind:value={row.from} placeholder="City of Westminster" />
						<Text color="muted">to</Text>
						<Input size="small" bind:value={row.to} placeholder="London" />
						<IconButton
							icon={mdiDelete}
							variant="ghost"
							color="danger"
							size="small"
							aria-label="remove alias"
							onclick={() => aliasRows.splice(i, 1)}
						/>
					</HStack>
				{/each}
				<div>
					<Button
						variant="outline"
						size="tiny"
						leadingIcon={mdiPlus}
						onclick={() => aliasRows.push({ from: '', to: '' })}
					>
						Add alias
					</Button>
				</div>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>Fixed events</CardTitle>
			<CardDescription>
				Every photo in the inclusive range, GPS or not, goes in the album.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={1}>
				{#each config.events as event, i (i)}
					<HStack gap={2}>
						<Input size="small" bind:value={event.name} placeholder="Our wedding" />
						<Input type="date" size="small" bind:value={event.from} />
						<Input type="date" size="small" bind:value={event.to} />
						<IconButton
							icon={mdiDelete}
							variant="ghost"
							color="danger"
							size="small"
							aria-label="remove event"
							onclick={() => config.events.splice(i, 1)}
						/>
					</HStack>
					{#if iss(`events[${i}].to`)}
						<Text color="danger" size="small">{iss(`events[${i}].to`)}</Text>
					{/if}
				{/each}
				<div>
					<Button
						variant="outline"
						size="tiny"
						leadingIcon={mdiPlus}
						onclick={() => config.events.push({ name: '', from: today(), to: today() })}
					>
						Add event
					</Button>
				</div>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			<CardTitle>
				<HStack class="justify-between">
					<span>config.toml</span>
					<Button variant="ghost" size="tiny" onclick={() => (showToml = !showToml)}>
						{showToml ? 'Hide' : 'Show'}
					</Button>
				</HStack>
			</CardTitle>
			<CardDescription>
				What Check file would write. Comments come from the template, not from the file on disk.
			</CardDescription>
		</CardHeader>
		{#if showToml}
			<CardBody>
				<pre
					class="bg-subtle border-subtle max-h-96 overflow-auto rounded-lg border p-3 font-mono text-xs">{toml}</pre>
			</CardBody>
		{/if}
	</Card>
</Stack>

{#if shown}
	<ZoneModal
		circles={shown.circles}
		onRename={(to) => renameZone(shown.name, to)}
		onAdd={() => addCircle(shown.name)}
		onRemove={removeCircle}
		onClose={() => (openZone = null)}
	/>
{/if}

