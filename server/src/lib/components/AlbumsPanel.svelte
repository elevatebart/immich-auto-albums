<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { Badge, Card, CardBody, Checkbox, HStack, Select, Stack, Text } from '@immich/ui';
	import CentroidsMap from '$lib/components/CentroidsMap.svelte';
	import type { Preview, PreviewRow } from '$lib/types';

	interface Props {
		preview: Preview;
		/** Row ids to write on apply. Empty for a draft, which cannot be applied. */
		selected: SvelteSet<string>;
		canApply: boolean;
	}

	let { preview, selected, canApply }: Props = $props();

	let hideNoop = $state(true);
	let kind = $state('all');
	let focused = $state<string | undefined>(undefined);

	const kinds = $derived(['all', ...new Set(preview.rows.map((r) => r.kind))].sort());
	const rows = $derived(
		[...preview.rows]
			.filter((r) => (hideNoop ? r.op !== 'noop' : true))
			.filter((r) => kind === 'all' || r.kind === kind)
			.sort((a, b) => b.start.localeCompare(a.start))
	);

	/** A click on the map scrolls its row into view. */
	$effect(() => {
		if (focused) document.getElementById(`row-${focused}`)?.scrollIntoView({ block: 'nearest' });
	});

	const toggle = (id: string) => (selected.has(id) ? selected.delete(id) : selected.add(id));
	const delta = (r: PreviewRow) =>
		[r.add ? `+${r.add}` : '', r.remove ? `-${r.remove}` : ''].filter(Boolean).join(' ');
	const opColor = (op: PreviewRow['op']) =>
		op === 'create' ? 'success' : op === 'update' ? 'warning' : 'secondary';
</script>

<Card>
	<CardBody>
		<Stack gap={3}>
			<Text color="muted" size="small">
				{preview.stats.assets} assets ({preview.stats.withGps} with GPS), {preview.stats.people}
				named people, {preview.stats.managedAlbums} managed albums, {preview.stats.absorbed}
				GPS-less photos absorbed into trips. Window since {preview.windowStart}.
				{#if preview.source === 'fixture'}
					<Badge color="secondary" size="small">fixture library</Badge>
				{/if}
			</Text>

			<CentroidsMap {rows} bind:focused />

			<HStack gap={3} class="flex-wrap">
				<HStack gap={2}>
					<Checkbox id="hide-noop" bind:checked={hideNoop} size="small" />
					<Text size="small" onclick={() => (hideNoop = !hideNoop)}>hide unchanged</Text>
				</HStack>
				<Select bind:value={kind} options={kinds} size="small" class="w-36" />
				<Text color="muted" size="small">
					{preview.stats.create} to create, {preview.stats.update} to update, {preview.stats.noop}
					unchanged
				</Text>
			</HStack>

			<table class="w-full text-sm">
				<thead class="text-primary">
					<tr class="border-subtle border-b text-left">
						<th class="w-7 py-2"></th>
						<th class="py-2 pe-2 font-medium">When</th>
						<th class="py-2 pe-2 font-medium">Album</th>
						<th class="py-2 text-right font-medium">Photos</th>
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
								{#if r.op !== 'noop' && canApply}
									<Checkbox
										checked={selected.has(r.id)}
										onCheckedChange={() => toggle(r.id)}
										size="small"
										aria-label="apply {r.name}"
									/>
								{/if}
							</td>
							<td class="py-2 pe-2">
								<div class="font-mono whitespace-nowrap">{r.start}</div>
								<Text color="muted" size="tiny">{r.kind}</Text>
							</td>
							<td class="py-2 pe-2">
								{r.userRenamed ? r.albumName : r.name}
								<HStack gap={1} class="flex-wrap pt-0.5">
									<Badge color={opColor(r.op)} size="small">{r.op}</Badge>
									{#if r.rename}<Badge color="info" size="small">rename</Badge>{/if}
									{#if r.userRenamed}<Badge color="primary" size="small">your name</Badge>{/if}
								</HStack>
								{#if r.userRenamed}<Text color="muted" size="tiny">auto: {r.name}</Text>{/if}
								{#if r.rename}<Text color="muted" size="tiny">was: {r.albumName}</Text>{/if}
							</td>
							<td class="py-2 text-right">
								<div class="font-mono">{r.assets}</div>
								{#if delta(r)}<Text color="muted" size="tiny">{delta(r)}</Text>{/if}
							</td>
						</tr>
					{/each}
					{#if !rows.length}
						<tr>
							<td colspan="4" class="py-3">
								<Text color="muted" size="small">
									No albums in this filter. The planner found {preview.rows.length} in total.
								</Text>
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</Stack>
	</CardBody>
</Card>
