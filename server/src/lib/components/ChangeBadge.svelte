<script lang="ts">
	import { Badge } from '@immich/ui';
	import { kindAt, type ChangeKind, type ConfigDiff } from '$core/diff.js';
	import { detailAt, dot, KIND_COLOR, KIND_WORD } from '$lib/change';

	interface Props {
		diff?: ConfigDiff;
		/** Field path to read the change from. `kind` and `detail` override it. */
		path?: string;
		kind?: ChangeKind;
		detail?: string;
		/** A dot instead of the badge, for a row that has no room for a word. */
		compact?: boolean;
	}

	let { diff, path, kind, detail, compact = false }: Props = $props();

	const shown = $derived(kind ?? (diff && path ? kindAt(diff, path) : undefined));
	const title = $derived(detail ?? (diff && path ? detailAt(diff, path) : ''));
</script>

{#if shown}
	{#if compact}
		<span
			class="size-2.5 shrink-0 rounded-full {dot(shown)}"
			role="img"
			aria-label={KIND_WORD[shown]}
			{title}
		></span>
	{:else}
		<Badge color={KIND_COLOR[shown]} size="small" {title}>{KIND_WORD[shown]}</Badge>
	{/if}
{/if}
