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

<div class="grid grid-cols-1 gap-x-4 py-1 sm:grid-cols-[16rem_1fr_9rem] sm:items-center">
	<Label for={id} {label} size="small" />
	<input
		{id}
		type="range"
		min={meta.minimum}
		max={meta.maximum}
		{step}
		bind:value
		class="accent-primary h-6 w-full"
		aria-label={label}
	/>
	<NumberInput
		bind:value
		size="small"
		min={meta.minimum}
		max={meta.maximum}
		{step}
		trailingText={unit}
		aria-label={label}
	/>
	{#if issue || meta.description}
		<div class="sm:col-start-2 sm:col-end-4">
			<Text size="tiny" color={issue ? 'danger' : 'muted'}>{issue ?? meta.description}</Text>
		</div>
	{/if}
</div>
