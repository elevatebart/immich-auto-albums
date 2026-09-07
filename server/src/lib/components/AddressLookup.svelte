<script lang="ts">
	import { mdiMapSearchOutline } from '@mdi/js';
	import { Badge, Button, HStack, Input, Stack, Text } from '@immich/ui';
	import type { GeoHit } from '$lib/types';

	interface Props {
		/** Row labels to fill, in order. Index -1 means a new home. */
		targets: string[];
		onpick: (hit: GeoHit, target: number) => void;
	}

	let { targets, onpick }: Props = $props();

	let query = $state('');
	let target = $state('-1');
	let hits = $state<GeoHit[]>([]);
	let error = $state<string | null>(null);
	let searching = $state(false);
	let searched = $state(false);

	async function search() {
		searching = true;
		error = null;
		try {
			const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			hits = body.hits;
			searched = true;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			searching = false;
		}
	}

	function pick(hit: GeoHit) {
		onpick(hit, Number(target));
		hits = [];
		query = '';
		searched = false;
	}
</script>

<Stack gap={2}>
	<Input
		bind:value={query}
		size="small"
		placeholder="Grenoble, or 12 Bd Voltaire Paris"
		onkeydown={(e) => e.key === 'Enter' && query.trim().length > 1 && search()}
	/>
	<HStack gap={2}>
		<select
			bind:value={target}
			class="border-subtle bg-light h-8 flex-1 rounded-md border px-2 text-sm"
		>
			<option value="-1">as a new home</option>
			{#each targets as t, i (i)}<option value={String(i)}>into {t}</option>{/each}
		</select>
		<Button
			variant="outline"
			size="small"
			leadingIcon={mdiMapSearchOutline}
			onclick={search}
			disabled={searching || query.trim().length < 2}
		>
			{searching ? 'Looking...' : 'Find'}
		</Button>
	</HStack>

	{#if error}<Text color="danger" size="small">{error}</Text>{/if}

	{#if hits.length}
		<Stack gap={1}>
			{#each hits as hit (`${hit.lat},${hit.lon},${hit.name}`)}
				<button
					type="button"
					onclick={() => pick(hit)}
					class="border-subtle hover:bg-subtle flex flex-col items-start gap-0.5 rounded-md border p-2 text-start"
				>
					<HStack gap={2}>
						<Text size="small">{hit.name}</Text>
						<Badge color={hit.source === 'immich' ? 'primary' : 'secondary'} size="small">
							{hit.source}
						</Badge>
					</HStack>
					{#if hit.detail}<Text color="muted" size="tiny">{hit.detail}</Text>{/if}
					<Text color="muted" size="tiny" class="font-mono">
						{hit.lat.toFixed(5)}, {hit.lon.toFixed(5)}
					</Text>
				</button>
			{/each}
		</Stack>
	{:else if searched}
		<Text color="muted" size="small">Nothing found. Try the town or the city instead.</Text>
	{/if}
</Stack>
