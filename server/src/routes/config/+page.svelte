<script lang="ts">
	import { onMount } from 'svelte';
	import {
		mdiContentSave,
		mdiDelete,
		mdiFileDocumentOutline,
		mdiPlus,
		mdiRefresh
	} from '@mdi/js';
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
		Heading,
		HelperText,
		IconButton,
		Input,
		Label,
		MultiSelect,
		NumberInput,
		Select,
		Stack,
		Switch,
		Text
	} from '@immich/ui';
	import { PLAN_KINDS, schemaField, type ConfigIssue } from '$core/schema.js';
	import type { Config } from '$core/types.js';
	import HomesMap from '$lib/components/HomesMap.svelte';
	import Slider from '$lib/components/Slider.svelte';
	import type { ConfigResponse, ConfigWriteResponse, PeopleResponse, Person } from '$lib/types';

	const today = () => new Date().toISOString().slice(0, 10);

	let config = $state<Config | null>(null);
	let aliasRows = $state<{ from: string; to: string }[]>([]);
	let etag = $state('');
	let file = $state('');
	let pristine = $state('');
	let people = $state<Person[]>([]);
	let peopleNote = $state('');

	let issues = $state<ConfigIssue[]>([]);
	let warnings = $state<string[]>([]);
	let toml = $state('');
	let showToml = $state(false);
	let error = $state<string | null>(null);
	let saved = $state<string | null>(null);
	let busy = $state(false);
	let map = $state<HomesMap | null>(null);

	/** Aliases are edited as rows so an empty key can exist while typing. */
	const payload = () =>
		config && {
			...config,
			aliases: Object.fromEntries(
				aliasRows.filter((r) => r.from.trim()).map((r) => [r.from.trim(), r.to])
			)
		};

	const dirty = $derived(!!config && JSON.stringify(payload()) !== pristine);
	const iss = (field: string) => issues.find((i) => i.field === field)?.message;
	const hint = (field: string) => schemaField(field).description;
	const peopleOptions = $derived(
		[...new Set([...people.map((p) => p.name), ...(config?.people.household ?? []), config?.people.me ?? ''])]
			.filter(Boolean)
			.sort()
	);

	async function load() {
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/config');
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			const data = body as ConfigResponse;
			config = data.config;
			aliasRows = Object.entries(data.config.aliases).map(([from, to]) => ({ from, to }));
			etag = data.etag;
			file = data.file;
			toml = data.toml;
			issues = [];
			warnings = [];
			pristine = JSON.stringify(payload());
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function loadPeople() {
		try {
			const res = await fetch('/api/people');
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			const data = body as PeopleResponse;
			people = data.people;
			peopleNote =
				data.source === 'fixture'
					? 'names from the fixture library'
					: `${data.people.length} named people in Immich`;
		} catch (e) {
			peopleNote = `people list unavailable: ${(e as Error).message}`;
		}
	}

	async function send(dryRun: boolean) {
		if (!config) return;
		busy = true;
		error = null;
		saved = null;
		try {
			const res = await fetch('/api/config', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ etag, config: payload(), dryRun })
			});
			const body = await res.json();
			if (res.status === 400 && body.issues) {
				issues = body.issues;
				error = body.error;
				return;
			}
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			const data = body as ConfigWriteResponse;
			issues = [];
			warnings = data.warnings;
			toml = data.toml;
			showToml = true;
			if (!dryRun) {
				config = data.config;
				aliasRows = Object.entries(data.config.aliases).map(([from, to]) => ({ from, to }));
				etag = data.etag;
				pristine = JSON.stringify(payload());
				saved = `Written to ${data.file}. Previous file kept at ${data.backup}. The preview cache was dropped, so rescan on the preview page.`;
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		load();
		loadPeople();
	});

	const addHome = () => config?.homes.push(map?.addAtCenter() ?? { from: today(), lat: 46.5, lon: 4 });
	const sortHomes = () => config?.homes.sort((a, b) => a.from.localeCompare(b.from));
	const outOfOrder = $derived(
		(config?.homes ?? []).some((h, i, all) => i > 0 && h.from < all[i - 1].from)
	);
</script>

<svelte:head><title>immich-auto-albums config</title></svelte:head>

<Stack gap={4}>
	<HStack class="justify-between">
		<Stack gap={0}>
			<Heading size="large">Configuration</Heading>
			<Text color="muted" size="small">{file || 'config.toml'}</Text>
		</Stack>
		<HStack gap={2}>
			<Button
				variant="outline"
				size="small"
				leadingIcon={mdiRefresh}
				onclick={load}
				disabled={busy}
			>
				Reload
			</Button>
			<Button
				variant="outline"
				size="small"
				leadingIcon={mdiFileDocumentOutline}
				onclick={() => send(true)}
				disabled={busy || !config}
			>
				Check file
			</Button>
			<Button
				size="small"
				leadingIcon={mdiContentSave}
				onclick={() => send(false)}
				disabled={busy || !dirty}
			>
				{dirty ? 'Save changes' : 'Saved'}
			</Button>
		</HStack>
	</HStack>

	{#if error}
		<Alert color="danger" title="Not saved">
			{error}
			{#if issues.length}
				<ul class="mt-1 list-inside list-disc">
					{#each issues as i (i.field)}<li>{i.field}: {i.message}</li>{/each}
				</ul>
			{/if}
		</Alert>
	{/if}
	{#each warnings as w (w)}
		<Alert color="warning" title="Worth a second look">{w}</Alert>
	{/each}
	{#if saved}
		<Alert color="success" title="Saved">{saved}</Alert>
	{/if}

	{#if config}
		<Card>
			<CardHeader>
				<CardTitle>Immich</CardTitle>
				<CardDescription>
					The API key is never stored here: it comes from IMMICH_API_KEY.
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
					<Field label="Me" invalid={!!iss('people.me')}>
						<Select bind:value={config.people.me} options={peopleOptions} placeholder="pick a person" />
					</Field>
					<Field
						label="Household"
						description={hint('people.household')}
					>
						<MultiSelect bind:values={config.people.household} options={peopleOptions} />
					</Field>
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
						<HStack gap={2} class="pb-2">
							<Switch
								checked={!!config.people.noPeopleFrom}
								onCheckedChange={(on) => {
									if (!config) return;
									config.people.noPeopleFrom = on ? today() : undefined;
									config.people.noPeopleTo = on ? today() : undefined;
								}}
							/>
							<Label label="Quiet period, no names in titles" size="small" />
						</HStack>
						{#if config.people.noPeopleFrom !== undefined}
							<HStack gap={2}>
								<Field label="From" invalid={!!iss('people.noPeopleFrom')}>
									<Input type="date" bind:value={config.people.noPeopleFrom} />
								</Field>
								<Field label="To" invalid={!!iss('people.noPeopleTo')}>
									<Input type="date" bind:value={config.people.noPeopleTo} />
								</Field>
							</HStack>
						{/if}
					</div>
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
										onclick={() => config?.people.noPeoplePlaces.splice(i, 1)}
									/>
								</HStack>
							{/each}
							<div>
								<Button
									variant="outline"
									size="tiny"
									leadingIcon={mdiPlus}
									onclick={() => config?.people.noPeoplePlaces.push('')}
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
					<HomesMap bind:this={map} bind:homes={config.homes} />
					{#if outOfOrder}
						<Alert color="warning" title="Out of order">
							Homes must run oldest first.
							<Button variant="outline" size="tiny" class="mt-2" onclick={sortHomes}>
								Sort by date
							</Button>
						</Alert>
					{/if}
					<table class="w-full text-sm">
						<thead class="text-primary">
							<tr class="border-subtle border-b text-left">
								<th class="py-1 pe-2 font-medium">From</th>
								<th class="py-1 pe-2 font-medium">Latitude</th>
								<th class="py-1 pe-2 font-medium">Longitude</th>
								<th class="py-1 pe-2 font-medium">Label</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each config.homes as home, i (i)}
								<tr class="border-subtle border-b">
									<td class="py-1 pe-2">
										<Input type="date" size="small" bind:value={home.from} />
									</td>
									<td class="py-1 pe-2">
										<NumberInput size="small" step={0.00001} bind:value={home.lat} />
									</td>
									<td class="py-1 pe-2">
										<NumberInput size="small" step={0.00001} bind:value={home.lon} />
									</td>
									<td class="py-1 pe-2">
										<Input size="small" bind:value={home.label} placeholder="optional" />
									</td>
									<td class="py-1">
										<IconButton
											icon={mdiDelete}
											variant="ghost"
											color="danger"
											size="small"
											aria-label="remove home"
											disabled={config.homes.length < 2}
											onclick={() => config?.homes.splice(i, 1)}
										/>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<div>
						<Button variant="outline" size="tiny" leadingIcon={mdiPlus} onclick={addHome}>
							Add home at map centre
						</Button>
					</div>
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
								onclick={() => config?.events.splice(i, 1)}
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
							onclick={() => config?.events.push({ name: '', from: today(), to: today() })}
						>
							Add event
						</Button>
					</div>
				</Stack>
			</CardBody>
		</Card>

		<Card>
			<CardHeader>
				<CardTitle>Name overrides</CardTitle>
				<CardDescription>
					Rename generated albums by kind and key prefix. The key is printed in the preview table.
				</CardDescription>
			</CardHeader>
			<CardBody>
				<Stack gap={1}>
					{#each config.overrides as override, i (i)}
						<HStack gap={2}>
							<Select bind:value={override.kind} options={[...PLAN_KINDS]} class="w-40" />
							<Input size="small" bind:value={override.keyPrefix} placeholder="2020-08" />
							<Input size="small" bind:value={override.name} placeholder="Around Lake Michigan" />
							<IconButton
								icon={mdiDelete}
								variant="ghost"
								color="danger"
								size="small"
								aria-label="remove override"
								onclick={() => config?.overrides.splice(i, 1)}
							/>
						</HStack>
					{/each}
					<div>
						<Button
							variant="outline"
							size="tiny"
							leadingIcon={mdiPlus}
							onclick={() =>
								config?.overrides.push({ kind: 'trip' as const, keyPrefix: '', name: '' })}
						>
							Add override
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
	{:else if busy}
		<Text color="muted">Reading config.toml...</Text>
	{/if}
</Stack>
