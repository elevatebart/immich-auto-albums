<script lang="ts">
	import { mdiDelete, mdiMapMarkerRadiusOutline, mdiPlus } from '@mdi/js';
	import {
		Alert,
		Badge,
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
		NumberInput,
		Stack,
		Text
	} from '@immich/ui';
	import { schemaField, type ConfigIssue } from '$core/schema.js';
	import { countAt, kindAt, type ChangeKind, type ConfigDiff } from '$core/diff.js';
	import type { Config, Zone } from '$core/types.js';
	import AddressLookup from '$lib/components/AddressLookup.svelte';
	import ChangeBadge from '$lib/components/ChangeBadge.svelte';
	import ChangeFrame from '$lib/components/ChangeFrame.svelte';
	import ChangeSummary from '$lib/components/ChangeSummary.svelte';
	import GoneList from '$lib/components/GoneList.svelte';
	import PeoplePicker from '$lib/components/PeoplePicker.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import StringList from '$lib/components/StringList.svelte';
	import ZoneModal from '$lib/components/ZoneModal.svelte';
	import { accent, detailAt } from '$lib/change';
	import type { Baseline, Person } from '$lib/types';

	interface Props {
		config: Config;
		/** Aliases are edited as rows so an empty key can exist while typing. */
		aliasRows: { from: string; to: string }[];
		issues: ConfigIssue[];
		people: Person[];
		peopleNote: string;
		toml: string;
		/** What the config on screen changes about the baseline, keyed by field path. */
		diff: ConfigDiff;
		baseline: Baseline;
		hasDefaults: boolean;
		onbaseline: (next: Baseline) => void;
	}

	let {
		config = $bindable(),
		aliasRows = $bindable(),
		issues,
		people,
		peopleNote,
		toml,
		diff,
		baseline,
		hasDefaults,
		onbaseline
	}: Props = $props();

	let showToml = $state(false);

	const today = () => new Date().toISOString().slice(0, 10);
	const iss = (field: string) => issues.find((i) => i.field === field)?.message;
	const hint = (field: string) => schemaField(field).description;

	/** Cards can hold a field from another section, so a count can exclude what another card shows. */
	const count = (paths: string[], except: string[] = []) =>
		countAt(diff, ...paths) - (except.length ? countAt(diff, ...except) : 0);

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

	/** A group is new only when every circle in it is, and changed when any circle moved. */
	function groupChange(circles: Zone[]): { kind?: ChangeKind; detail: string } {
		const paths = circles.map((c) => `zones[${config.zones.indexOf(c)}]`);
		const kinds = paths.map((p) => kindAt(diff, p));
		const kind = kinds.every((k) => k === 'added')
			? 'added'
			: kinds.some((k) => k)
				? 'changed'
				: undefined;
		return { kind, detail: paths.map((p) => detailAt(diff, p)).filter(Boolean).join('; ') };
	}

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

{#snippet heading(text: string, paths: string[], except: string[] = [])}
	{@const n = count(paths, except)}
	<CardTitle>
		<HStack gap={2} class="justify-between">
			<span>{text}</span>
			{#if n}<Badge color="warning" size="small">{n} changed</Badge>{/if}
		</HStack>
	</CardTitle>
{/snippet}

<Stack gap={4}>
	<ChangeSummary {diff} {baseline} {hasDefaults} {onbaseline} />

	<Card>
		<CardHeader>
			{@render heading('Immich', ['immich'])}
			<CardDescription>
				No credential is ever stored here: it comes from signing in, or from IMMICH_API_KEY.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={4}>
				<ChangeFrame {diff} path="immich.url">
					<Field label="Server URL" invalid={!!iss('immich.url')}>
						<Input bind:value={config.immich.url} placeholder="http://nas:2283" />
						{#if iss('immich.url')}<HelperText color="danger">{iss('immich.url')}</HelperText>{/if}
					</Field>
				</ChangeFrame>
				<ChangeFrame {diff} path="immich.outDir">
					<Field label="Output directory" description={hint('immich.outDir')}>
						<Input bind:value={config.immich.outDir} />
					</Field>
				</ChangeFrame>
				<ChangeFrame {diff} path="immich.marker">
					<Field
						label="Album marker"
						description={hint('immich.marker')}
						invalid={!!iss('immich.marker')}
					>
						<Input bind:value={config.immich.marker} />
					</Field>
				</ChangeFrame>
				<Slider
					label="Recompute window"
					field="immich.windowDays"
					bind:value={config.immich.windowDays}
					unit="days"
					{issues}
					{diff}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			{@render heading('People', ['people'])}
			<CardDescription>{peopleNote}</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={4}>
				<ChangeFrame {diff} path="people.me">
					<PeoplePicker
						label="Me"
						description={hint('people.me')}
						{people}
						selected={config.people.me ? [config.people.me] : []}
						multiple={false}
						onchange={(names) => (config.people.me = names[0] ?? '')}
					/>
				</ChangeFrame>
				{#if iss('people.me')}<Text color="danger" size="small">{iss('people.me')}</Text>{/if}
				<ChangeFrame {diff} path="people.household">
					<PeoplePicker
						label="Household"
						description={hint('people.household')}
						{people}
						selected={config.people.household}
						onchange={(names) => (config.people.household = names)}
					/>
					<GoneList {diff} path="people.household" />
				</ChangeFrame>
				<Slider
					label="Guest share of tagged photos"
					field="people.withShare"
					bind:value={config.people.withShare}
					step={0.05}
					{issues}
					{diff}
				/>
				<Slider
					label="Minimum tagged photos"
					field="people.withMinTagged"
					bind:value={config.people.withMinTagged}
					{issues}
					{diff}
				/>
				<Slider
					label="Maximum names in a title"
					field="people.maxNamed"
					bind:value={config.people.maxNamed}
					{issues}
					{diff}
				/>
				<StringList
					label="Places that never get names"
					description={hint('people.noPeoplePlaces')}
					path="people.noPeoplePlaces"
					bind:values={config.people.noPeoplePlaces}
					{diff}
					addLabel="Add place"
					noun="place"
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			{@render heading('Homes', ['homes'])}
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
									<HStack gap={1}>
										<ChangeBadge {diff} path={`homes[${i}]`} compact />
										<IconButton
											icon={mdiDelete}
											variant="ghost"
											color="danger"
											size="small"
											aria-label="remove home"
											disabled={config.homes.length < 2}
											onclick={() => config.homes.splice(i, 1)}
										/>
									</HStack>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				</div>
				<GoneList {diff} path="homes" />
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
			{@render heading('Zones', ['zones', 'clustering.zoneShare'])}
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
					{@const change = groupChange(group.circles)}
					<HStack
						gap={2}
						class="border-subtle flex-wrap justify-between border-b pb-2 {accent(change.kind)}"
					>
						<Stack gap={0}>
							<HStack gap={2}>
								<Text size="small">{group.name}</Text>
								<ChangeBadge kind={change.kind} detail={change.detail} />
							</HStack>
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
				<GoneList {diff} path="zones" />
				<div>
					<Button variant="outline" size="tiny" leadingIcon={mdiPlus} onclick={addZone}>Add zone</Button>
				</div>
				<Slider
					label="Zone share"
					field="clustering.zoneShare"
					bind:value={config.clustering.zoneShare}
					{issues}
					{diff}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			{@render heading('Clustering', ['clustering'], [
				'clustering.zoneShare',
				'clustering.eventAbsorbShare'
			])}
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
					{diff}
				/>
				<Slider
					label="Place radius"
					field="clustering.placeKm"
					bind:value={config.clustering.placeKm}
					step={0.5}
					unit="km"
					{issues}
					{diff}
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
					{diff}
				/>
				<Slider
					label="Dominant place share"
					field="clustering.dominantShare"
					bind:value={config.clustering.dominantShare}
					step={0.05}
					{issues}
					{diff}
				/>
				<Slider
					label="Region share"
					field="clustering.regionShare"
					bind:value={config.clustering.regionShare}
					step={0.05}
					{issues}
					{diff}
				/>
				<Slider
					label="Trip gap"
					field="clustering.tripGapHours"
					bind:value={config.clustering.tripGapHours}
					unit="hours"
					{issues}
					{diff}
				/>
				<Slider
					label="Trip minimum photos"
					field="clustering.tripMinPhotos"
					bind:value={config.clustering.tripMinPhotos}
					{issues}
					{diff}
				/>
				<Slider
					label="Trip minimum days"
					field="clustering.tripMinDays"
					bind:value={config.clustering.tripMinDays}
					{issues}
					{diff}
				/>
				<Slider
					label="Day trip minimum photos"
					field="clustering.daytripMinPhotos"
					bind:value={config.clustering.daytripMinPhotos}
					{issues}
					{diff}
				/>
				<Slider
					label="Gathering gap"
					field="clustering.gatherGapHours"
					bind:value={config.clustering.gatherGapHours}
					step={0.5}
					unit="hours"
					{issues}
					{diff}
				/>
				<Slider
					label="Gathering minimum photos"
					field="clustering.gatherMinPhotos"
					bind:value={config.clustering.gatherMinPhotos}
					{issues}
					{diff}
				/>
				<Slider
					label="Gathering minimum guests"
					field="clustering.gatherMinGuests"
					bind:value={config.clustering.gatherMinGuests}
					{issues}
					{diff}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			{@render heading('Person years and seasons', ['personYears', 'seasons'])}
		</CardHeader>
		<CardBody>
			<Stack gap={2}>
				<Slider
					label="Person year minimum photos"
					field="personYears.minPhotos"
					bind:value={config.personYears.minPhotos}
					{issues}
					{diff}
				/>
				<Slider
					label="Household minimum photos"
					field="personYears.householdMinPhotos"
					bind:value={config.personYears.householdMinPhotos}
					{issues}
					{diff}
				/>
				<ChangeFrame {diff} path="seasons.noGpsEraEnd">
					<Field
						label="GPS-less era ends"
						description={hint('seasons.noGpsEraEnd')}
						invalid={!!iss('seasons.noGpsEraEnd')}
					>
						<Input type="date" bind:value={config.seasons.noGpsEraEnd} />
					</Field>
				</ChangeFrame>
				<Slider
					label="Season minimum photos"
					field="seasons.minPhotos"
					bind:value={config.seasons.minPhotos}
					{issues}
					{diff}
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			{@render heading('Naming', ['naming'])}
			<CardDescription>
				Countries named after their district (a French departement) instead of their region, and the
				regions that keep naming albums anyway.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<Stack gap={4}>
				<StringList
					label="District countries"
					description={hint('naming.districtCountries')}
					path="naming.districtCountries"
					bind:values={config.naming.districtCountries}
					{diff}
					addLabel="Add country"
					placeholder="France"
					noun="country"
				/>
				<StringList
					label="Regions that keep their name"
					description={hint('naming.keepRegions')}
					path="naming.keepRegions"
					bind:values={config.naming.keepRegions}
					{diff}
					addLabel="Add region"
					placeholder="Normandy"
					noun="region"
				/>
			</Stack>
		</CardBody>
	</Card>

	<Card>
		<CardHeader>
			{@render heading('Place aliases', ['aliases'])}
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
						{#if row.from.trim()}
							<ChangeBadge {diff} path={`aliases.${row.from.trim()}`} compact />
						{/if}
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
				<GoneList {diff} path="aliases" keyed />
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
			{@render heading('Fixed events', ['events', 'clustering.eventAbsorbShare'])}
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
						<ChangeBadge {diff} path={`events[${i}]`} compact />
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
				<GoneList {diff} path="events" />
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
				<Slider
					label="Event absorb share"
					field="clustering.eventAbsorbShare"
					bind:value={config.clustering.eventAbsorbShare}
					step={0.05}
					{issues}
					{diff}
				/>
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
