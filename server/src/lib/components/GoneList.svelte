<script lang="ts">
	import { Badge, HStack, Text } from '@immich/ui';
	import type { ConfigDiff } from '$core/diff.js';
	import { valueText } from '$lib/change';

	interface Props {
		diff: ConfigDiff;
		/** Collection path. Its removals have no row left to carry a badge. */
		path: string;
		/** Aliases are keyed by their left side, which the value alone does not carry. */
		keyed?: boolean;
	}

	let { diff, path, keyed = false }: Props = $props();
	const gone = $derived(diff.gone[path] ?? []);
</script>

{#each gone as item (item.key)}
	<HStack gap={2} class="border-danger border-s-2 ps-2">
		<Badge color="danger" size="small">removed</Badge>
		<Text size="tiny" color="muted" class="line-through">
			{keyed ? `${item.key} to ${valueText(item.before)}` : valueText(item.before)}
		</Text>
	</HStack>
{/each}
