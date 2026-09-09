<script lang="ts">
	import type { Snippet } from 'svelte';
	import { HStack } from '@immich/ui';
	import { kindAt, type ConfigDiff } from '$core/diff.js';
	import { accent } from '$lib/change';
	import ChangeBadge from '$lib/components/ChangeBadge.svelte';

	interface Props {
		diff: ConfigDiff;
		path: string;
		children: Snippet;
	}

	let { diff, path, children }: Props = $props();
	const kind = $derived(kindAt(diff, path));
</script>

<div class={accent(kind)}>
	{#if kind}
		<HStack class="justify-end"><ChangeBadge {diff} {path} /></HStack>
	{/if}
	{@render children()}
</div>
