<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		mdiCloudUploadOutline,
		mdiContentSave,
		mdiFileDocumentOutline,
		mdiKeyVariant,
		mdiLogoutVariant,
		mdiRefresh
	} from '@mdi/js';
	import { Alert, Button, Checkbox, ConfirmModal, HStack, Heading, Stack, Text } from '@immich/ui';
	import type { ConfigIssue } from '$core/schema.js';
	import type { Config, Scope } from '$core/types.js';
	import AlbumsPanel from '$lib/components/AlbumsPanel.svelte';
	import ApiKeyCard from '$lib/components/ApiKeyCard.svelte';
	import ConfigPanel from '$lib/components/ConfigPanel.svelte';
	import Progress from '$lib/components/Progress.svelte';
	import SignInPanel from '$lib/components/SignInPanel.svelte';
	import type {
		ApplyResponse,
		AuthState,
		ConfigResponse,
		ConfigWriteResponse,
		PeopleResponse,
		Person,
		Preview
	} from '$lib/types';

	let auth = $state<AuthState | null>(null);
	let showKey = $state(false);
	let config = $state<Config | null>(null);
	let aliasRows = $state<{ from: string; to: string }[]>([]);
	let etag = $state('');
	let file = $state('');
	let pristine = $state('');
	let toml = $state('');
	let people = $state<Person[]>([]);
	let peopleNote = $state('');

	let saved = $state<Preview | null>(null);
	let shown = $state<Preview | null>(null);
	let selected = $state(new SvelteSet<string>());

	let issues = $state<ConfigIssue[]>([]);
	let warnings = $state<string[]>([]);
	let error = $state<string | null>(null);
	let note = $state<string | null>(null);
	let result = $state<ApplyResponse | null>(null);
	let busy = $state(false);
	let scanning = $state(false);
	let recomputing = $state(false);
	let applying = $state(false);
	let confirming = $state(false);
	/** The window is the default; the whole library is the bypass. */
	let scope = $state<Scope>('window');

	const payload = () =>
		config && {
			...config,
			aliases: Object.fromEntries(
				aliasRows.filter((r) => r.from.trim()).map((r) => [r.from.trim(), r.to])
			)
		};

	const dirty = $derived(!!config && JSON.stringify(payload()) !== pristine);
	const changed = $derived((shown?.rows ?? []).filter((r) => r.op !== 'noop'));
	const canApply = $derived(!!shown && !recomputing && !scanning);
	const chosen = $derived(changed.filter((r) => selected.has(r.id)));
	const summary = $derived({
		create: chosen.filter((r) => r.op === 'create').length,
		update: chosen.filter((r) => r.op === 'update').length,
		rename: chosen.filter((r) => r.op === 'rename').length,
		add: chosen.reduce((s, r) => s + r.add, 0),
		remove: chosen.reduce((s, r) => s + r.remove, 0)
	});

	async function api<T>(url: string, init?: RequestInit): Promise<T> {
		const res = await fetch(url, init);
		const body = await res.json();
		if (res.status === 400 && body.issues) {
			issues = body.issues;
			throw new Error(body.error);
		}
		// 401 means the session went away, so the sign in card comes back with the address filled.
		if (res.status === 401) void loadAuth();
		if (!res.ok) throw new Error(body.error ?? res.statusText);
		return body as T;
	}

	async function loadAuth() {
		try {
			const res = await fetch('/api/auth');
			auth = res.ok ? ((await res.json()) as AuthState) : null;
		} catch {
			auth = null;
		}
	}

	/** Everything the page needs once there is a credential to read Immich with. */
	async function start() {
		await loadAuth();
		await loadConfig();
		void loadAlbums();
		void loadPeople();
	}

	async function signOut() {
		await fetch('/api/auth', { method: 'DELETE' }).catch(() => null);
		saved = null;
		shown = null;
		config = null;
		showKey = false;
		error = null;
		await loadAuth();
		// A saved key in the environment survives the sign out, so the page keeps working on it.
		if (auth?.signedIn) await start();
	}

	async function loadConfig() {
		busy = true;
		error = null;
		try {
			const data = await api<ConfigResponse>('/api/config');
			config = data.config;
			aliasRows = Object.entries(data.config.aliases).map(([from, to]) => ({ from, to }));
			etag = data.etag;
			file = data.file;
			toml = data.toml;
			issues = [];
			warnings = [];
			pristine = JSON.stringify(payload());
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function loadAlbums(refresh = false) {
		scanning = true;
		error = null;
		try {
			saved = await api<Preview>(`/api/preview?scope=${scope}${refresh ? '&refresh=1' : ''}`);
			if (!dirty) select(saved);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			scanning = false;
		}
	}

	async function loadPeople() {
		try {
			const data = await api<PeopleResponse>('/api/people');
			people = data.people;
			peopleNote =
				data.source === 'fixture'
					? 'names from the fixture library'
					: `${data.people.length} named people in Immich`;
		} catch (e) {
			peopleNote = `people list unavailable: ${(e as Error).message}`;
		}
	}

	/** Plans the unsaved config over the cached library, so the right panel follows the handles. */
	async function loadDraft(body: unknown) {
		recomputing = true;
		try {
			shown = await api<Preview>('/api/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ config: body, scope })
			});
			issues = [];
			error = null;
			select(shown);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			recomputing = false;
		}
	}

	async function saveConfig(dryRun: boolean) {
		busy = true;
		error = null;
		note = null;
		result = null;
		try {
			const data = await api<ConfigWriteResponse>('/api/config', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ etag, config: payload(), dryRun })
			});
			issues = [];
			warnings = data.warnings;
			toml = data.toml;
			if (!dryRun) {
				config = data.config;
				aliasRows = Object.entries(data.config.aliases).map(([from, to]) => ({ from, to }));
				etag = data.etag;
				pristine = JSON.stringify(payload());
				note = `Written to ${data.file}, previous file kept at ${data.backup}.`;
				await loadAlbums();
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (!shown) return;
		applying = true;
		error = null;
		result = null;
		try {
			const data = await api<ApplyResponse>('/api/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					token: shown.token,
					confirm: true,
					ids: [...selected],
					scope,
					config: shown.draft ? payload() : undefined
				})
			});
			result = data;
			await loadAlbums(true);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			applying = false;
		}
	}

	const select = (p: Preview) =>
		(selected = new SvelteSet(p.rows.filter((r) => r.op !== 'noop').map((r) => r.id)));

	onMount(async () => {
		await loadAuth();
		if (auth && !auth.signedIn && !auth.demo) return;
		await loadConfig();
		void loadAlbums();
		void loadPeople();
	});

	/** Switching scope needs a fresh plan from the server, in both directions. */
	$effect(() => {
		if (saved && saved.scope !== scope) loadAlbums();
	});

	/** Every handle move lands here: same config, show the saved plan; changed, debounce a draft. */
	$effect(() => {
		const body = payload();
		const json = JSON.stringify(body);
		if (!body || !saved || saved.scope !== scope) return;
		if (json === pristine) {
			shown = saved;
			select(saved);
			return;
		}
		const timer = setTimeout(() => loadDraft(body), 400);
		return () => clearTimeout(timer);
	});
</script>

<svelte:head><title>immich-auto-albums</title></svelte:head>

{#if auth && !auth.signedIn && !auth.demo}
	<SignInPanel {auth} onSignedIn={start} />
{:else}
<div class="grid gap-5 lg:h-[calc(100vh-7.5rem)] lg:grid-cols-[minmax(26rem,42%)_1fr]">
	<section class="flex min-h-0 flex-col gap-3">
		{#if auth?.source === 'session'}
			<HStack class="justify-end" gap={2}>
				<Text color="muted" size="tiny">
					{auth.email}{auth.expiresAt
						? `, until ${new Date(auth.expiresAt).toLocaleString()}`
						: ''}
				</Text>
				<Button
					variant="ghost"
					size="tiny"
					leadingIcon={mdiKeyVariant}
					onclick={() => (showKey = !showKey)}
				>
					Key
				</Button>
				<Button variant="ghost" size="tiny" leadingIcon={mdiLogoutVariant} onclick={signOut}>
					Sign out
				</Button>
			</HStack>
		{/if}
		<HStack class="justify-between">
			<Stack gap={0}>
				<Heading size="small">Configuration</Heading>
				<Text color="muted" size="tiny">{file || 'config.toml'}</Text>
			</Stack>
			<HStack gap={2}>
				<Button
					variant="outline"
					size="tiny"
					leadingIcon={mdiRefresh}
					onclick={loadConfig}
					disabled={busy}
				>
					Reload
				</Button>
				<Button
					variant="outline"
					size="tiny"
					leadingIcon={mdiFileDocumentOutline}
					onclick={() => saveConfig(true)}
					disabled={busy || !config}
				>
					Check file
				</Button>
				<Button
					size="tiny"
					leadingIcon={mdiContentSave}
					onclick={() => saveConfig(false)}
					disabled={busy || !dirty}
				>
					{dirty ? 'Save' : 'Saved'}
				</Button>
			</HStack>
		</HStack>

		<div class="min-h-0 flex-1 overflow-y-auto pe-1 lg:pb-2">
			{#if showKey}
				<div class="mb-3"><ApiKeyCard /></div>
			{/if}
			{#if config}
				<ConfigPanel bind:config bind:aliasRows {issues} {people} {peopleNote} {toml} />
			{:else if busy}
				<Text color="muted">Reading config.toml...</Text>
			{/if}
		</div>
	</section>

	<section class="flex min-h-0 flex-col gap-3">
		<HStack class="justify-between">
			<Stack gap={0}>
				<Heading size="small">Albums</Heading>
				<Text color="muted" size="tiny">
					{#if recomputing}
						replanning...
					{:else if shown?.draft}
						{changed.length} to write, from the config on screen
					{:else if scanning}
						scanning the library...
					{:else if scope === 'window'}
						{changed.length} to write since {shown?.windowStart ?? 'the window'}
					{:else}
						{changed.length} to write, whole library
					{/if}
				</Text>
			</Stack>
			<HStack gap={2}>
				<HStack gap={1} class="pe-1">
					<Checkbox
						id="whole-library"
						checked={scope === 'all'}
						onCheckedChange={(on) => (scope = on ? 'all' : 'window')}
						size="small"
					/>
					<Text size="tiny" onclick={() => (scope = scope === 'all' ? 'window' : 'all')}>
						whole library
					</Text>
				</HStack>
				<Button
					variant="outline"
					size="tiny"
					leadingIcon={mdiRefresh}
					onclick={() => loadAlbums(true)}
					disabled={scanning || applying}
				>
					{scanning ? 'Scanning...' : 'Rescan'}
				</Button>
				<Button
					size="tiny"
					leadingIcon={mdiCloudUploadOutline}
					onclick={() => (confirming = true)}
					disabled={!canApply || applying || !chosen.length}
					title={shown?.draft ? 'Writes the plan from the config on screen, saved or not' : ''}
				>
					Apply {chosen.length}
				</Button>
			</HStack>
		</HStack>

		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:pb-2">
			{#if error}
				<Alert color="danger" title="Nothing was written">
					{error}
					{#if issues.length}
						<ul class="mt-1 list-inside list-disc">
							{#each issues as i (i.field)}<li>{i.field}: {i.message}</li>{/each}
						</ul>
					{/if}
				</Alert>
			{/if}
			{#each warnings as w (w)}
				<Alert color="warning" title="Worth a second look">{w}</Alert>
			{/each}
			{#if note}
				<Alert color="success" title="Done">{note}</Alert>
			{/if}
			{#if result}
				<Alert
					color={result.failed ? 'danger' : 'success'}
					title={result.failed
						? `${result.failed} album${result.failed > 1 ? 's' : ''} could not be written`
						: result.dryRun
							? 'Dry run, nothing written'
							: 'Written to Immich'}
				>
					{result.applied} of {result.results.length} went through.
					{#each result.results.filter((r) => !r.ok) as r (r.id)}
						<div class="pt-1 text-sm">
							<b>{r.name}</b>: {r.error}
						</div>
					{/each}
					{#if result.failed}
						<div class="pt-2 text-sm">
							Nothing else changed. Fix the cause and apply again: the albums that went through show as
							unchanged on the next rescan.
						</div>
					{/if}
				</Alert>
			{/if}

			<Progress active={scanning || applying || recomputing} />

			{#if shown}
				{#if scanning}
					<Text color="muted" size="small">
						Rescanning the library. These rows are the previous scan until it lands.
					</Text>
				{/if}
				<div class:opacity-60={recomputing || scanning}>
					<AlbumsPanel
						preview={shown}
						{selected}
						{canApply}
						draftConfig={shown.draft ? payload() : undefined}
						{scope}
					/>
				</div>
			{:else if scanning}
				<Text color="muted">Scanning the library. A first run over a large library takes a while.</Text>
			{/if}
		</div>
	</section>
</div>
{/if}

{#if confirming && shown}
	<ConfirmModal
		title="Write to Immich?"
		confirmText={applying ? 'Applying...' : 'Confirm and write'}
		confirmColor="primary"
		disabled={applying}
		prompt={`${summary.create} albums created, ${summary.update} updated, ${summary.rename} renamed, ${summary.add} photos added, ${summary.remove} removed. ${
			shown.source === 'fixture'
				? 'The fixture library has no Immich behind it, so this runs as a dry run.'
				: 'Only albums carrying the marker are touched, and album names you changed by hand are kept.'
		}${
			shown.draft
				? ' This plan comes from the config on screen, which is not saved: the scheduled run will keep using the saved one until you save.'
				: ''
		}`}
		onClose={(confirmed) => {
			confirming = false;
			if (confirmed) apply();
		}}
	/>
{/if}
