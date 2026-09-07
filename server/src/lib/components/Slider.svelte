<script lang="ts">
	import { Label, NumberInput, Text } from '@immich/ui';
	import { schemaField, type ConfigIssue } from '$core/schema.js';

	interface Props {
		label: string;
		/** Dotted path into Config. The range, the hint and the issue all key off it. */
		field: string;
		value: number;
		step?: number;
		unit?: string;
		issues?: ConfigIssue[];
	}

	let { label, field, value = $bindable(), step = 1, unit, issues = [] }: Props = $props();

	const meta = $derived(schemaField(field));
	const issue = $derived(issues.find((i) => i.field === field)?.message);
	const id = $props.id();
</script>

<div class="flex flex-col gap-1 py-2">
	<div class="flex items-center justify-between gap-3">
		<Label for={id} {label} size="small" />
		<div class="flex w-28 items-center gap-1">
			<NumberInput
				bind:value
				size="small"
				min={meta.minimum}
				max={meta.maximum}
				{step}
				aria-label={label}
			/>
			{#if unit}<Text color="muted" size="tiny" class="whitespace-nowrap">{unit}</Text>{/if}
		</div>
	</div>
	<input
		{id}
		type="range"
		min={meta.minimum}
		max={meta.maximum}
		{step}
		bind:value
		class="accent-primary h-5 w-full"
		aria-label={label}
	/>
	{#if issue || meta.description}
		<Text size="tiny" color={issue ? 'danger' : 'muted'}>{issue ?? meta.description}</Text>
	{/if}
</div>
