<script lang="ts">
	import { mdiDelete, mdiPlus } from '@mdi/js';
	import { Button, HStack, IconButton, Input, Label, Stack, Text } from '@immich/ui';
	import type { ConfigDiff } from '$core/diff.js';
	import ChangeBadge from '$lib/components/ChangeBadge.svelte';
	import GoneList from '$lib/components/GoneList.svelte';

	interface Props {
		label: string;
		description?: string;
		/** Collection path, so each row can be matched against the baseline by its value. */
		path: string;
		values: string[];
		diff: ConfigDiff;
		addLabel: string;
		placeholder?: string;
		noun: string;
	}

	let { label, description, path, values = $bindable(), diff, addLabel, placeholder, noun }: Props =
		$props();
</script>

<div>
	<Label {label} size="small" />
	{#if description}<Text color="muted" size="small" class="mb-2">{description}</Text>{/if}
	<Stack gap={1}>
		{#each values as _, i (i)}
			<HStack gap={2}>
				<Input bind:value={values[i]} {placeholder} />
				<ChangeBadge {diff} path={`${path}[${i}]`} />
				<IconButton
					icon={mdiDelete}
					variant="ghost"
					color="danger"
					size="small"
					aria-label={`remove ${noun}`}
					onclick={() => values.splice(i, 1)}
				/>
			</HStack>
		{/each}
		<GoneList {diff} {path} />
		<div>
			<Button variant="outline" size="tiny" leadingIcon={mdiPlus} onclick={() => values.push('')}>
				{addLabel}
			</Button>
		</div>
	</Stack>
</div>
