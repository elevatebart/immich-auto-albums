<script lang="ts">
	import { HStack, ProgressBar, Text } from '@immich/ui';
	import type { Job } from '$lib/types';

	interface Props {
		/** Poll while the client knows something long is running. */
		active: boolean;
	}

	let { active }: Props = $props();
	let job = $state<Job | null>(null);

	const WORDS: Record<Job['phase'], string> = {
		assets: 'Reading photos',
		people: 'Reading faces',
		albums: 'Reading albums',
		apply: 'Writing albums'
	};

	$effect(() => {
		if (!active) {
			job = null;
			return;
		}
		let alive = true;
		const tick = async () => {
			try {
				const res = await fetch('/api/progress');
				const body = await res.json();
				if (alive) job = body.job;
			} catch {
				// the next tick can try again
			}
		};
		tick();
		const timer = setInterval(tick, 700);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	});

	const pct = $derived(job && job.total ? Math.min(1, job.done / job.total) : undefined);
</script>

{#if job}
	<div class="flex flex-col gap-1">
		<HStack class="justify-between">
			<Text size="small">
				{WORDS[job.phase]}{job.label ? `: ${job.label}` : ''}
			</Text>
			<Text color="muted" size="small" class="font-mono">
				{job.total ? `${job.done.toLocaleString()} / ${job.total.toLocaleString()}` : job.done.toLocaleString()}
			</Text>
		</HStack>
		<ProgressBar
			value={pct ?? 1}
			color={job.error ? 'danger' : 'primary'}
			size="small"
			animate={pct === undefined}
		/>
	</div>
{/if}
