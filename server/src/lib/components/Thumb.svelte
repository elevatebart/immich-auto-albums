<script lang="ts">
	import { mdiImageOutline } from '@mdi/js';
	import { Icon } from '@immich/ui';

	interface Props {
		id: string;
		size?: 'strip' | 'grid';
		/** thumbnail is the small square, preview is the bigger one. */
		quality?: 'thumbnail' | 'preview';
		class?: string;
	}

	let { id, size = 'strip', quality = 'thumbnail', class: className = '' }: Props = $props();
	let failed = $state(false);

	// The box holds its space whether or not the image ever loads, so the grid cannot jump.
	const box = $derived(size === 'strip' ? 'size-9' : 'aspect-square w-full');
</script>

<div class="bg-subtle relative overflow-hidden rounded {box} {className}">
	{#if failed}
		<div class="text-muted flex h-full w-full items-center justify-center" title="no thumbnail">
			<Icon icon={mdiImageOutline} size="1.1em" />
		</div>
	{:else}
		<img
			src="/api/assets/{id}/thumbnail?size={quality}"
			alt=""
			loading="lazy"
			class="h-full w-full object-cover"
			onerror={() => (failed = true)}
		/>
	{/if}
</div>
