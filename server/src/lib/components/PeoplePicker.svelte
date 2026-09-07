<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { Avatar, Input, Label, Text } from '@immich/ui';
	import type { Person } from '$lib/types';

	interface Props {
		label: string;
		description?: string;
		people: Person[];
		/** Immich person names, which is what the planner and the album titles use. */
		selected: string[];
		multiple?: boolean;
		onchange: (names: string[]) => void;
	}

	let { label, description, people, selected, multiple = true, onchange }: Props = $props();

	let query = $state('');
	/** Ids whose thumbnail did not load, so the tile falls back to initials. */
	let broken = $state(new SvelteSet<string>());

	const hit = (p: Person) => p.name.toLowerCase().includes(query.trim().toLowerCase());
	const tiles = $derived(
		[...people]
			.filter((p) => !query.trim() || hit(p))
			.sort((a, b) => Number(selected.includes(b.name)) - Number(selected.includes(a.name)))
	);
	/** Names kept from the config that Immich does not know, so a typo stays visible. */
	const unknown = $derived(selected.filter((n) => !people.some((p) => p.name === n)));

	function toggle(name: string) {
		if (!multiple) return onchange(selected.includes(name) ? [] : [name]);
		onchange(
			selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]
		);
	}
</script>

<div>
	<Label {label} size="small" />
	{#if description}<Text color="muted" size="small" class="mb-1">{description}</Text>{/if}

	{#if people.length > 12}
		<Input bind:value={query} size="small" placeholder="filter by name" class="mb-2" />
	{/if}

	<div class="border-subtle max-h-60 overflow-y-auto rounded-lg border p-2">
		<div class="flex flex-wrap gap-1">
			{#each tiles as p (p.id)}
				{@const on = selected.includes(p.name)}
				<button
					type="button"
					onclick={() => toggle(p.name)}
					title={p.name}
					aria-pressed={on}
					class="flex w-[4.5rem] flex-col items-center gap-1 rounded-lg p-1.5 text-center hover:bg-subtle"
					class:bg-primary-50={on}
					class:ring-2={on}
					class:ring-primary={on}
				>
					{#if broken.has(p.id)}
						<Avatar name={p.name} size="medium" />
					{:else}
						<img
							src="/api/people/{p.id}/thumbnail"
							alt=""
							loading="lazy"
							class="size-10 rounded-full object-cover"
							onerror={() => broken.add(p.id)}
						/>
					{/if}
					<Text size="tiny" class="leading-tight break-words">{p.name}</Text>
				</button>
			{/each}
			{#if !tiles.length}
				<Text color="muted" size="small">
					{people.length ? 'no match' : 'no people loaded from Immich'}
				</Text>
			{/if}
		</div>
	</div>

	{#if unknown.length}
		<Text color="muted" size="tiny" class="pt-1">
			Not found in Immich: {unknown.join(', ')}. They never match a face.
		</Text>
	{/if}
</div>
