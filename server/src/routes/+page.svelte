<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { mdiCloudUploadOutline, mdiMapMarkerOutline, mdiRefresh } from '@mdi/js';
	import {
		Alert,
		Badge,
		Button,
		Card,
		CardBody,
		Checkbox,
		ConfirmModal,
		HStack,
		Heading,
		Icon,
		Link,
		Select,
		Stack,
		Text
	} from '@immich/ui';
	import CentroidsMap from '$lib/components/CentroidsMap.svelte';
	import type { ApplyResponse, Preview, PreviewRow } from '$lib/types';

	let preview = $state<Preview | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let hideNoop = $state(true);
	let kind = $state('all');
	let selected = $state(new SvelteSet<string>());
	let confirming = $state(false);
	let applying = $state(false);
	let result = $state<ApplyResponse | null>(null);
	let focused = $state<string | undefined>(undefined);

	async function load(refresh = false) {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/preview${refresh ? '?refresh=1' : ''}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			preview = body as Preview;
			selected = new SvelteSet(changed(preview).map((r) => r.id));
			confirming = false;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	/** Sends the token of the preview on screen, so a plan that moved underneath is rejected. */
	async function apply() {
		if (!preview) return;
		applying = true;
		error = null;
		try {
			const res = await fetch('/api/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: preview.token, confirm: true, ids: [...selected] })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			result = body as ApplyResponse;
			await load(true);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			applying = false;
		}
	}

	onMount(() => load());

	const changed = (p: Preview) => p.rows.filter((r) => r.op !== 'noop');
	const toggle = (id: string) => (selected.has(id) ? selected.delete(id) : selected.add(id));

	const kinds = $derived(['all', ...new Set((preview?.rows ?? []).map((r) => r.kind))].sort());
	const rows = $derived(
		[...(preview?.rows ?? [])]
			.filter((r) => (hideNoop ? r.op !== 'noop' : true))
			.filter((r) => kind === 'all' || r.kind === kind)
			.sort((a, b) => b.start.localeCompare(a.start))
	);

	const chosen = $derived((preview ? changed(preview) : []).filter((r) => selected.has(r.id)));
	const summary = $derived({
		create: chosen.filter((r) => r.op === 'create').length,
		update: chosen.filter((r) => r.op === 'update').length,
		add: chosen.reduce((s, r) => s + r.add, 0),
		remove: chosen.reduce((s, r) => s + r.remove, 0)
	});

	/** A click on the map scrolls its row into view. */
	$effect(() => {
		if (focused) document.getElementById(`row-${focused}`)?.scrollIntoView({ block: 'nearest' });
	});

	const delta = (r: PreviewRow) =>
		[r.add ? `+${r.add}` : '', r.remove ? `-${r.remove}` : ''].filter(Boolean).join(' ') || '-';
	const osm = (c: { lat: number; lon: number }) =>
		`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=9/${c.lat}/${c.lon}`;
	const opColor = (op: PreviewRow['op']) =>
		op === 'create' ? 'success' : op === 'update' ? 'warning' : 'secondary';
</script>

<svelte:head><title>immich-auto-albums preview</title></svelte:head>

<Stack gap={4}>
	<HStack class="justify-between">
		<Stack gap={0}>
			<Heading size="large">Album preview</Heading>
			{#if preview}
				<Text color="muted" size="small">
					{preview.stats.assets} assets ({preview.stats.withGps} with GPS), {preview.stats.people}
					named people, {preview.stats.managedAlbums} managed albums, {preview.stats.absorbed}
					GPS-less photos absorbed into trips. Window since {preview.windowStart}.
					{#if preview.source === 'fixture'}
						<Badge color="secondary" size="small">fixture library</Badge>
					{/if}
				</Text>
			{/if}
		</Stack>
		<HStack gap={2}>
			<Button
				variant="outline"
				size="small"
				leadingIcon={mdiRefresh}
				onclick={() => load(true)}
				disabled={loading || applying}
			>
				{loading ? 'Scanning...' : 'Rescan'}
			</Button>
			<Button
				size="small"
				leadingIcon={mdiCloudUploadOutline}
				onclick={() => (confirming = true)}
				disabled={loading || applying || !chosen.length}
			>
				Apply {chosen.length} selected
			</Button>
		</HStack>
	</HStack>

	{#if error}
		<Alert color="danger" title="Nothing was written">{error}</Alert>
	{/if}

	{#if result}
		<Alert
			color={result.failed ? 'warning' : 'success'}
			title={result.dryRun ? 'Dry run, nothing written' : 'Written to Immich'}
		>
			{result.applied} ok, {result.failed} failed.
			{#each result.results.filter((r) => !r.ok) as r (r.id)}
				<div class="text-sm">{r.name}: {r.error}</div>
			{/each}
		</Alert>
	{/if}

	{#if preview}
		<Card>
			<CardBody>
				<Stack gap={3}>
					<HStack gap={4} class="flex-wrap">
						<HStack gap={2}>
							<Checkbox id="hide-noop" bind:checked={hideNoop} size="small" />
							<Text size="small" onclick={() => (hideNoop = !hideNoop)}>hide unchanged</Text>
						</HStack>
						<Select bind:value={kind} options={kinds} size="small" class="w-44" />
						<Text color="muted" size="small">
							{rows.length} of {preview.rows.length} rows, {preview.stats.create} to create,
							{preview.stats.update} to update, {preview.stats.noop} unchanged
						</Text>
					</HStack>

					<CentroidsMap {rows} bind:focused />

					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead class="text-primary">
								<tr class="border-subtle border-b text-left">
									<th class="w-8 py-2"></th>
									<th class="py-2 pe-3 font-medium">Start</th>
									<th class="py-2 pe-3 font-medium">Kind</th>
									<th class="py-2 pe-3 font-medium">Album</th>
									<th class="py-2 pe-3 font-medium">Change</th>
									<th class="py-2 pe-3 text-right font-medium">Assets</th>
									<th class="py-2 pe-3 text-right font-medium">Delta</th>
									<th class="py-2 font-medium">Centroid</th>
								</tr>
							</thead>
							<tbody>
								{#each rows as r (r.id)}
									<tr
										id="row-{r.id}"
										class="border-subtle border-b align-top"
										class:bg-primary-50={focused === r.id}
										onclick={() => (focused = r.id)}
									>
										<td class="py-2">
											{#if r.op !== 'noop'}
												<Checkbox
													checked={selected.has(r.id)}
													onCheckedChange={() => toggle(r.id)}
													size="small"
													aria-label="apply {r.name}"
												/>
											{/if}
										</td>
										<td class="py-2 pe-3 font-mono whitespace-nowrap">{r.start}</td>
										<td class="py-2 pe-3">{r.kind}</td>
										<td class="py-2 pe-3">
											{r.userRenamed ? r.albumName : r.name}
											{#if r.userRenamed}
												<Text color="muted" size="tiny">auto: {r.name}</Text>
											{/if}
											{#if r.rename}
												<Text color="muted" size="tiny">was: {r.albumName}</Text>
											{/if}
										</td>
										<td class="py-2 pe-3">
											<HStack gap={1} class="flex-wrap">
												<Badge color={opColor(r.op)} size="small">{r.op}</Badge>
												{#if r.rename}<Badge color="info" size="small">rename</Badge>{/if}
												{#if r.userRenamed}<Badge color="primary" size="small">your name</Badge>{/if}
											</HStack>
										</td>
										<td class="py-2 pe-3 text-right font-mono">{r.assets}</td>
										<td class="py-2 pe-3 text-right font-mono">{delta(r)}</td>
										<td class="py-2 font-mono whitespace-nowrap">
											{#if r.centroid}
												<Link href={osm(r.centroid)} target="_blank" rel="noreferrer">
													<HStack gap={1}>
														<Icon icon={mdiMapMarkerOutline} size="1em" />
														{r.centroid.lat.toFixed(3)}, {r.centroid.lon.toFixed(3)}
													</HStack>
												</Link>
											{:else}
												<Text color="muted">-</Text>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</Stack>
			</CardBody>
		</Card>
	{:else if loading}
		<Text color="muted">Scanning the library. A first run over a large library takes a while.</Text>
	{/if}
</Stack>

{#if confirming && preview}
	<ConfirmModal
		title="Write to Immich?"
		confirmText={applying ? 'Applying...' : 'Confirm and write'}
		confirmColor="primary"
		disabled={applying}
		prompt={`${summary.create} albums created, ${summary.update} updated, ${summary.add} photos added, ${summary.remove} removed. ${
			preview.source === 'fixture'
				? 'The fixture library has no Immich behind it, so this runs as a dry run.'
				: 'Only albums carrying the marker are touched, and album names you changed by hand are kept.'
		}`}
		onClose={(confirmed) => {
			confirming = false;
			if (confirmed) apply();
		}}
	/>
{/if}
