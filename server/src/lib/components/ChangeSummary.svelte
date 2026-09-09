<script lang="ts">
	import { Badge, Button, HStack, Text } from '@immich/ui';
	import { countAll, type ConfigDiff } from '$core/diff.js';
	import type { Baseline } from '$lib/types';

	interface Props {
		diff: ConfigDiff;
		baseline: Baseline;
		/** config.example.toml is not in every deployment, so the switch can be half disabled. */
		hasDefaults: boolean;
		onbaseline: (next: Baseline) => void;
	}

	let { diff, baseline, hasDefaults, onbaseline }: Props = $props();

	const total = $derived(countAll(diff));
	const source = $derived(baseline === 'saved' ? 'the saved file' : 'config.example.toml');
</script>

<HStack class="border-subtle bg-subtle justify-between rounded-lg border px-3 py-2" gap={3}>
	<HStack gap={2} class="min-w-0">
		{#if total}<Badge color="warning" size="small">{total}</Badge>{/if}
		<Text size="tiny" color={total ? 'warning' : 'muted'} class="truncate">
			{total
				? `${total} change${total > 1 ? 's' : ''} against ${source}`
				: `same as ${source}`}
		</Text>
	</HStack>
	<HStack gap={1} class="shrink-0">
		<Button
			size="tiny"
			variant={baseline === 'saved' ? 'filled' : 'outline'}
			onclick={() => onbaseline('saved')}
		>
			Saved
		</Button>
		<Button
			size="tiny"
			variant={baseline === 'defaults' ? 'filled' : 'outline'}
			disabled={!hasDefaults}
			title={hasDefaults ? 'config.example.toml, the starting point' : 'config.example.toml is not next to the config'}
			onclick={() => onbaseline('defaults')}
		>
			Defaults
		</Button>
	</HStack>
</HStack>
