<script lang="ts">
	import { mdiImageMultipleOutline } from '@mdi/js';
	import { Badge, HStack, Modal, ModalBody, ModalFooter, Stack, Text } from '@immich/ui';
	import Thumb from '$lib/components/Thumb.svelte';
	import type { AlbumAssets, PreviewRow } from '$lib/types';

	interface Props {
		row: PreviewRow;
		/** The draft config when the panel shows a draft, so the modal opens the same plan. */
		draftConfig?: unknown;
		onClose: () => void;
	}

	let { row, draftConfig, onClose }: Props = $props();

	let data = $state<AlbumAssets | null>(null);
	let error = $state<string | null>(null);

	const adding = $derived(new Set(data?.add ?? []));

	$effect(() => {
		load();
	});

	async function load() {
		try {
			const res = await fetch('/api/albums/assets', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: row.id, config: draftConfig })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			data = body as AlbumAssets;
		} catch (e) {
			error = (e as Error).message;
		}
	}
</script>

<Modal
	title={row.userRenamed ? (row.albumName ?? row.name) : row.name}
	icon={mdiImageMultipleOutline}
	size="giant"
	closeOnBackdropClick
	{onClose}
>
	<ModalBody>
		<!-- The modal card shrink wraps its content, so the grid needs a width of its own. -->
		<Stack gap={3} class="w-[min(88vw,58rem)]">
			<HStack gap={2} class="flex-wrap">
				<Badge color={row.op === 'create' ? 'success' : row.op === 'update' ? 'warning' : 'secondary'}>
					{row.op}
				</Badge>
				<Text color="muted" size="small">{row.kind}, from {row.start}</Text>
				{#if row.add}<Badge color="success" size="small">+{row.add} joining</Badge>{/if}
				{#if row.remove}<Badge color="danger" size="small">-{row.remove} leaving</Badge>{/if}
			</HStack>

			{#if error}
				<Text color="danger" size="small">{error}</Text>
			{:else if !data}
				<Text color="muted" size="small">Loading photos...</Text>
			{:else}
				<div class="grid w-full grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
					{#each data.ids as id (id)}
						<div class="relative">
							<Thumb {id} size="grid" quality="thumbnail" />
							{#if adding.has(id)}
								<span
									class="ring-success absolute inset-0 rounded ring-2"
									title="joining the album"
								></span>
							{/if}
						</div>
					{/each}
				</div>
				{#if data.remove.length}
					<Text color="muted" size="small">Leaving the album</Text>
					<div class="grid w-full grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
						{#each data.remove as id (id)}
							<div class="relative opacity-60">
								<Thumb {id} size="grid" quality="thumbnail" />
								<span class="ring-danger absolute inset-0 rounded ring-2"></span>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</Stack>
	</ModalBody>
	<ModalFooter>
		<Text color="muted" size="small">
			{#if data}
				{data.total} photos{data.total > data.ids.length ? `, showing the first ${data.ids.length}` : ''}
			{/if}
		</Text>
	</ModalFooter>
</Modal>
