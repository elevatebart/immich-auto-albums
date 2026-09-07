<script lang="ts">
	import { Label, NumberInput, Text } from '@immich/ui';

	interface Props {
		label: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		hint?: string;
		issue?: string;
	}

	let { label, value = $bindable(), min, max, step = 1, unit, hint, issue }: Props = $props();
	const id = $props.id();
</script>

<div class="grid grid-cols-1 gap-x-4 py-1 sm:grid-cols-[16rem_1fr_9rem] sm:items-center">
	<Label for={id} {label} size="small" />
	<input
		{id}
		type="range"
		{min}
		{max}
		{step}
		bind:value
		class="accent-primary h-6 w-full"
		aria-label={label}
	/>
	<NumberInput bind:value size="small" {min} {max} {step} trailingText={unit} aria-label={label} />
	{#if hint || issue}
		<div class="sm:col-start-2 sm:col-end-4">
			<Text size="tiny" color={issue ? 'danger' : 'muted'}>{issue ?? hint}</Text>
		</div>
	{/if}
</div>
