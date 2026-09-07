<script lang="ts">
	import { onMount } from 'svelte';
	import type { Preview, PreviewRow } from '$lib/types';

	let preview = $state<Preview | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let hideNoop = $state(true);
	let kind = $state('all');

	async function load(refresh = false) {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/preview${refresh ? '?refresh=1' : ''}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? res.statusText);
			preview = body as Preview;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(() => load());

	const kinds = $derived([...new Set(preview?.rows.map((r) => r.kind) ?? [])].sort());
	const rows = $derived(
		[...(preview?.rows ?? [])]
			.filter((r) => (hideNoop ? r.op !== 'noop' : true))
			.filter((r) => kind === 'all' || r.kind === kind)
			.sort((a, b) => b.start.localeCompare(a.start))
	);

	const delta = (r: PreviewRow) =>
		[r.add ? `+${r.add}` : '', r.remove ? `-${r.remove}` : ''].filter(Boolean).join(' ') || '-';
	const osm = (c: { lat: number; lon: number }) =>
		`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=9/${c.lat}/${c.lon}`;
</script>

<svelte:head><title>immich-auto-albums preview</title></svelte:head>

<header>
	<h1>Album preview</h1>
	<button onclick={() => load(true)} disabled={loading}>
		{loading ? 'Scanning...' : 'Rescan'}
	</button>
</header>

{#if error}
	<p class="error">{error}</p>
{/if}

{#if preview}
	<p class="stats">
		{preview.stats.assets} assets ({preview.stats.withGps} with GPS), {preview.stats.people} named
		people, {preview.stats.managedAlbums} managed albums, {preview.stats.absorbed} GPS-less photos
		absorbed into trips. Window since {preview.windowStart}.
		{#if preview.source === 'fixture'}<span class="fixture">fixture library</span>{/if}
	</p>
	<p class="stats">
		<b>{preview.stats.create}</b> to create, <b>{preview.stats.update}</b> to update,
		<b>{preview.stats.noop}</b> unchanged. Nothing is written to Immich from this page.
	</p>

	<div class="filters">
		<label><input type="checkbox" bind:checked={hideNoop} /> hide unchanged</label>
		<select bind:value={kind}>
			<option value="all">all kinds</option>
			{#each kinds as k (k)}<option value={k}>{k}</option>{/each}
		</select>
		<span class="muted">{rows.length} rows</span>
	</div>

	<table>
		<thead>
			<tr>
				<th>Start</th>
				<th>Kind</th>
				<th>Album</th>
				<th>Change</th>
				<th class="num">Assets</th>
				<th class="num">Delta</th>
				<th>Centroid</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.kind + r.key)}
				<tr>
					<td class="mono">{r.start}</td>
					<td>{r.kind}</td>
					<td>
						{r.userRenamed ? r.albumName : r.name}
						{#if r.userRenamed}<div class="muted">auto: {r.name}</div>{/if}
						{#if r.rename}<div class="muted">was: {r.albumName}</div>{/if}
					</td>
					<td>
						<span class="badge {r.op}">{r.op}</span>
						{#if r.rename}<span class="badge rename">rename</span>{/if}
						{#if r.userRenamed}<span class="badge kept">your name</span>{/if}
					</td>
					<td class="num mono">{r.assets}</td>
					<td class="num mono">{delta(r)}</td>
					<td class="mono">
						{#if r.centroid}
							<a href={osm(r.centroid)} target="_blank" rel="noreferrer">
								{r.centroid.lat.toFixed(3)}, {r.centroid.lon.toFixed(3)}
							</a>
						{:else}
							-
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else if loading}
	<p class="muted">Scanning the library. A first run over a large library takes a while.</p>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 1.5rem;
		font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
		color: #1b1b1b;
		background: #fbfbfa;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
	}
	h1 {
		font-size: 1.25rem;
		margin: 0 0 0.5rem;
	}
	button {
		font: inherit;
		padding: 0.25rem 0.75rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
	button:disabled {
		color: #999;
		cursor: default;
	}
	.stats {
		margin: 0.25rem 0;
		max-width: 70ch;
	}
	.filters {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0 0.5rem;
	}
	.muted {
		color: #6b6b6b;
	}
	.error {
		padding: 0.5rem 0.75rem;
		border-left: 3px solid #b42318;
		background: #fef3f2;
	}
	.fixture {
		padding: 0 0.4rem;
		border-radius: 3px;
		background: #eaeaea;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.35rem 0.6rem;
		border-bottom: 1px solid #e6e6e6;
		vertical-align: top;
	}
	th {
		font-weight: 600;
		border-bottom: 1px solid #ccc;
	}
	.num {
		text-align: right;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		white-space: nowrap;
	}
	.badge {
		display: inline-block;
		padding: 0 0.4rem;
		border-radius: 3px;
		font-size: 12px;
		white-space: nowrap;
	}
	.create {
		background: #dcf5e3;
		color: #0a5c2b;
	}
	.update {
		background: #fdf0d0;
		color: #7a4a00;
	}
	.noop {
		background: #ececec;
		color: #555;
	}
	.rename {
		background: #dce8fb;
		color: #12457a;
	}
	.kept {
		background: #ebe0fb;
		color: #4b2380;
	}
</style>
