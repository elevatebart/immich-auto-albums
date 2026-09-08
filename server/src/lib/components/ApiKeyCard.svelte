<script lang="ts">
	import { mdiCheck, mdiContentCopy, mdiContentSave, mdiKeyVariant } from '@mdi/js';
	import { Button, Card, CardBody, CardDescription, CardHeader, CardTitle, HStack, Stack, Text } from '@immich/ui';
	import type { KeyResponse } from '$lib/types';

	let key = $state<KeyResponse | null>(null);
	let busy = $state(false);
	let note = $state<string | null>(null);
	let copied = $state(false);

	const line = $derived(key ? `IMMICH_API_KEY=${key.secret}` : '');

	async function call<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
		const res = await fetch(path, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? res.statusText);
		return data as T;
	}

	async function mint() {
		busy = true;
		note = null;
		try {
			key = await call<KeyResponse>('/api/auth?key=1', {});
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function save() {
		if (!key) return;
		busy = true;
		note = null;
		try {
			const out = await call<{ file: string; backup: string | null }>('/api/auth', { secret: key.secret }, 'PUT');
			note = `Saved to ${out.file}${out.backup ? `, previous text in ${out.backup}` : ''}.`;
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(line);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			note = 'Copying needs a secure context, so select the line and copy it by hand.';
		}
	}
</script>

<Card color="secondary">
	<CardHeader>
		<CardTitle>API key</CardTitle>
		<CardDescription>
			Your session ends when you sign out or the server restarts. A key does not, which is what a
			scheduled run needs. Skip this unless you run one.
		</CardDescription>
	</CardHeader>
	<CardBody>
		<Stack gap={3}>
			{#if key}
				<code class="bg-subtle rounded p-2 text-xs break-all">{line}</code>
				<Text color="muted" size="tiny">
					{key.name} can {key.checks.filter((c) => c.ok).map((c) => c.label).join(', ')}, and may write
					albums ({key.untested.join(', ')}), which cannot be tested without changing the library.
				</Text>
				<Text color="muted" size="tiny">{key.envFile}</Text>
				<HStack gap={2}>
					<Button variant="outline" size="tiny" leadingIcon={copied ? mdiCheck : mdiContentCopy} onclick={copy}>
						{copied ? 'Copied' : 'Copy'}
					</Button>
					<Button
						size="tiny"
						leadingIcon={mdiContentSave}
						onclick={save}
						disabled={busy || !key.envWritable}
						title={key.envWritable ? key.envFile : `${key.envFile} is not writable`}
					>
						Save to {key.envFile.split('/').pop()}
					</Button>
				</HStack>
				{#if !key.envWritable}
					<Text color="warning" size="tiny">
						{key.envFile} cannot be written from here, so copy the line into it yourself.
					</Text>
				{/if}
			{:else}
				<HStack>
					<Button variant="outline" size="tiny" leadingIcon={mdiKeyVariant} onclick={mint} disabled={busy}>
						{busy ? 'Creating...' : 'Create a key'}
					</Button>
				</HStack>
			{/if}
			{#if note}<Text size="tiny">{note}</Text>{/if}
		</Stack>
	</CardBody>
</Card>
