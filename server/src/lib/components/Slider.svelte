<script lang="ts">
	import { Label, NumberInput, Text } from '@immich/ui';
	import { schemaField, type ConfigIssue } from '$core/schema.js';
	import { EMPTY_DIFF, type ConfigDiff } from '$core/diff.js';
	import { accent, valueText } from '$lib/change';
	import ChangeBadge from '$lib/components/ChangeBadge.svelte';

	interface Props {
		label: string;
		/** Dotted path into Config. The range, the hint, the issue and the change all key off it. */
		field: string;
		value: number;
		/** Defaults to 0.05 on a 0..1 field, else 1, so a share slider does not snap to full. */
		step?: number;
		unit?: string;
		issues?: ConfigIssue[];
		diff?: ConfigDiff;
	}

	let {
		label,
		field,
		value = $bindable(),
		step,
		unit,
		issues = [],
		diff = EMPTY_DIFF
	}: Props = $props();

	const meta = $derived(schemaField(field));
	const gap = $derived(step ?? ((meta.maximum ?? 1) <= 1 ? 0.05 : 1));
	const issue = $derived(issues.find((i) => i.field === field)?.message);
	const change = $derived(diff.changes[field]);
	const id = $props.id();
</script>

<div class="flex flex-col gap-1 py-2 {accent(change?.kind)}">
	<div class="flex items-center justify-between gap-3">
		<div class="flex min-w-0 items-center gap-2">
			<Label for={id} {label} size="small" />
			<ChangeBadge {diff} path={field} />
		</div>
		<div class="flex w-28 items-center gap-1">
			<NumberInput
				bind:value
				size="small"
				min={meta.minimum}
				max={meta.maximum}
				step={gap}
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
		step={gap}
		bind:value
		class="accent-primary h-5 w-full"
		aria-label={label}
	/>
	<div class="flex items-baseline justify-between gap-3">
		{#if issue || meta.description}
			<Text size="tiny" color={issue ? 'danger' : 'muted'}>{issue ?? meta.description}</Text>
		{/if}
		{#if change}
			<Text size="tiny" color="warning" class="shrink-0 whitespace-nowrap">
				was {valueText(change.before)}
			</Text>
		{/if}
	</div>
</div>
