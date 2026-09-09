<script lang="ts">
	import { Badge } from '@immich/ui';
	import { kindAt, type ChangeKind, type ConfigDiff } from '$core/diff.js';
	import { detailAt, KIND_COLOR, KIND_WORD } from '$lib/change';

	interface Props {
		diff?: ConfigDiff;
		/** Field path to read the change from. `kind` and `detail` override it. */
		path?: string;
		kind?: ChangeKind;
		detail?: string;
	}

	let { diff, path, kind, detail }: Props = $props();

	const shown = $derived(kind ?? (diff && path ? kindAt(diff, path) : undefined));
	const title = $derived(detail ?? (diff && path ? detailAt(diff, path) : ''));
</script>

{#if shown}
	<Badge color={KIND_COLOR[shown]} size="small" {title}>{KIND_WORD[shown]}</Badge>
{/if}
