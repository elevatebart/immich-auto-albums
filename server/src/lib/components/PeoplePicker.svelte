<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { mdiAccountMultipleOutline, mdiPencilOutline } from '@mdi/js';
	import {
		Avatar,
		Button,
		HStack,
		Input,
		Label,
		Modal,
		ModalBody,
		ModalFooter,
		Text
	} from '@immich/ui';
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

	let open = $state(false);
	let query = $state('');
	/** Ids whose thumbnail did not load, so the tile falls back to initials. */
	let broken = $state(new SvelteSet<string>());

	const hit = (p: Person) => p.name.toLowerCase().includes(query.trim().toLowerCase());
	const tiles = $derived(
		[...people]
			.filter((p) => !query.trim() || hit(p))
			.sort((a, b) => Number(selected.includes(b.name)) - Number(selected.includes(a.name)))
	);
	const chosen = $derived(people.filter((p) => selected.includes(p.name)));
	/** Names kept from the config that Immich does not know, so a typo stays visible. */
	const unknown = $derived(selected.filter((n) => !people.some((p) => p.name === n)));

	function toggle(name: string) {
		if (!multiple) {
			onchange(selected.includes(name) ? [] : [name]);
			open = false;
			return;
		}
		onchange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
	}
</script>

{#snippet face(p: Person, size: 'small' | 'large')}
	{#if broken.has(p.id)}
		<Avatar name={p.name} size={size === 'large' ? 'medium' : 'small'} />
	{:else}
		<img
			src="/api/people/{p.id}/thumbnail"
			alt=""
			loading="lazy"
			class="rounded-full object-cover {size === 'large' ? 'size-12' : 'size-8'}"
			onerror={() => broken.add(p.id)}
		/>
	{/if}
{/snippet}

<div>
	<Label {label} size="small" />
	{#if description}<Text color="muted" size="small" class="mb-1">{description}</Text>{/if}

	<button
		type="button"
		onclick={() => ((open = true), (query = ''))}
		class="border-subtle hover:bg-subtle flex w-full items-center gap-2 rounded-lg border p-2 text-start"
	>
		<div class="flex flex-1 flex-wrap items-center gap-2">
			{#each chosen as p (p.id)}
				<HStack gap={1}>
					{@render face(p, 'small')}
					<Text size="tiny">{p.name}</Text>
				</HStack>
			{/each}
			{#if !chosen.length}
				<Text color="muted" size="small">
					{multiple ? 'nobody yet' : 'nobody picked'}
				</Text>
			{/if}
		</div>
		<Text color="muted" size="tiny" class="flex items-center gap-1 whitespace-nowrap">
			{chosen.length ? 'change' : 'pick'}
		</Text>
	</button>

	{#if unknown.length}
		<Text color="muted" size="tiny" class="pt-1">
			Not found in Immich: {unknown.join(', ')}. They never match a face.
		</Text>
	{/if}
</div>

{#if open}
	<Modal
		title={label}
		icon={multiple ? mdiAccountMultipleOutline : mdiPencilOutline}
		size="large"
		closeOnBackdropClick
		onClose={() => (open = false)}
	>
		<ModalBody>
			<Input bind:value={query} placeholder="filter by name" class="mb-3" autofocus />
			<div class="flex max-h-[50vh] flex-wrap gap-1 overflow-y-auto">
				{#each tiles as p (p.id)}
					{@const on = selected.includes(p.name)}
					<button
						type="button"
						onclick={() => toggle(p.name)}
						title={p.name}
						aria-pressed={on}
						class="hover:bg-subtle flex w-24 flex-col items-center gap-1 rounded-lg p-2 text-center"
						class:bg-primary-50={on}
						class:ring-2={on}
						class:ring-primary={on}
					>
						{@render face(p, 'large')}
						<Text size="tiny" class="leading-tight break-words">{p.name}</Text>
					</button>
				{/each}
				{#if !tiles.length}
					<Text color="muted" size="small">
						{people.length ? 'no match' : 'no people loaded from Immich'}
					</Text>
				{/if}
			</div>
		</ModalBody>
		<ModalFooter>
			<HStack fullWidth class="justify-between">
				<Text color="muted" size="small">
					{selected.length} picked of {people.length} named people
				</Text>
				<Button shape="round" onclick={() => (open = false)}>Done</Button>
			</HStack>
		</ModalFooter>
	</Modal>
{/if}
