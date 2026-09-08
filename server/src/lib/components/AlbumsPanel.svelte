<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { Alert, Badge, Card, CardBody, Checkbox, HStack, Select, Stack, Text } from '@immich/ui';
	import AlbumModal from '$lib/components/AlbumModal.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import type { Preview, PreviewRow } from '$lib/types';

	interface Props {
		preview: Preview;
		/** Row ids to write on apply. Empty for a draft, which cannot be applied. */
		selected: SvelteSet<string>;
		canApply: boolean;
		/** Passed to the modal so it opens the same plan the list is showing. */
		draftConfig?: unknown;
		scope?: string;
	}

	let { preview, selected, canApply, draftConfig, scope }: Props = $props();

	let opened = $state<PreviewRow | null>(null);
	let thumbHint = $state<string | null>(null);
	let probed = false;

	/** A 403 on a thumbnail means the key lacks asset.view, which is worth saying out loud. */
	$effect(() => {
		const id = preview.rows.find((r) => r.sample.length)?.sample[0];
		if (!id || probed) return;
		probed = true;
		fetch(`/api/assets/${id}/thumbnail`).then((res) => {
			if (res.status === 403) thumbHint = 'Add asset.view to the API key to see the photos.';
		});
	});

	let hideNoop = $state(true);
	let kind = $state('all');
	const kinds = $derived(['all', ...new Set(preview.rows.map((r) => r.kind))].sort());
	const rows = $derived(
		[...preview.rows]
			.filter((r) => (hideNoop ? r.op !== 'noop' : true))
			.filter((r) => kind === 'all' || r.kind === kind)
			.sort((a, b) => b.start.localeCompare(a.start))
	);

	const toggle = (id: string) => (selected.has(id) ? selected.delete(id) : selected.add(id));
	const opColor = (op: PreviewRow['op']) =>
		op === 'create' ? 'success' : op === 'update' ? 'warning' : op === 'rename' ? 'info' : 'secondary';
</script>

<Card>
	<CardBody>
		<Stack gap={3}>
			<Text color="muted" size="small">
				{preview.stats.assets} assets ({preview.stats.withGps} with GPS), {preview.stats.people}
				named people, {preview.stats.managedAlbums} managed albums, {preview.stats.absorbed}
				GPS-less photos absorbed into trips{preview.stats.folded
					? `, ${preview.stats.folded} clusters folded into your events`
					: ''}. Window since {preview.windowStart}.
				{#if preview.source === 'fixture'}
					<Badge color="secondary" size="small">fixture library</Badge>
				{/if}
			</Text>

			{#each preview.warnings as w (w)}
				<Alert color="warning" title="Leftover albums">{w}</Alert>
			{/each}

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
				{#if thumbHint}<Text color="warning" size="small">{thumbHint}</Text>{/if}
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
							class="border-subtle border-b align-top">
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
								<button
									type="button"
									onclick={(e) => (e.stopPropagation(), (opened = r))}
									class="hover:text-primary text-start underline-offset-2 hover:underline"
								>
									{r.userRenamed ? r.albumName : r.name}
								</button>
								{#if r.sample.length}
									<HStack gap={1} class="pt-1">
										{#each r.sample as id (id)}
											<Thumb {id} />
										{/each}
										{#if r.assets > r.sample.length}
											<Text color="muted" size="tiny">+{r.assets - r.sample.length}</Text>
										{/if}
									</HStack>
								{/if}
								<HStack gap={1} class="flex-wrap pt-0.5">
									<Badge color={opColor(r.op)} size="small">{r.op}</Badge>
									{#if r.op === 'update'}
										{#if r.add}<Badge color="success" size="small">+{r.add} joining</Badge>{/if}
										{#if r.remove}<Badge color="danger" size="small">-{r.remove} leaving</Badge>{/if}
									{/if}
									{#if r.rename && r.op !== 'rename'}<Badge color="info" size="small">rename</Badge>{/if}
									{#if r.userRenamed}<Badge color="primary" size="small">your name</Badge>{/if}
								</HStack>
								{#if r.userRenamed}<Text color="muted" size="tiny">auto: {r.name}</Text>{/if}
								{#if r.rename}<Text color="muted" size="tiny">was: {r.albumName}</Text>{/if}
							</td>
							<td class="py-2 text-right">
								<div class="font-mono">{r.assets}</div>
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

{#if opened}
	<AlbumModal row={opened} {draftConfig} {scope} onClose={() => (opened = null)} />
{/if}
