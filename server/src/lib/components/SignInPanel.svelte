<script lang="ts">
	import { untrack } from 'svelte';
	import { mdiCogOutline, mdiLoginVariant } from '@mdi/js';
	import {
		Alert,
		Button,
		Card,
		CardBody,
		CardDescription,
		CardHeader,
		CardTitle,
		Field,
		HStack,
		Input,
		Stack,
		Text
	} from '@immich/ui';
	import type { AuthState, SignInResponse } from '$lib/types';

	interface Props {
		auth: AuthState;
		onSignedIn: () => void;
	}

	let { auth, onSignedIn }: Props = $props();

	const URL_KEY = 'immich-auto-albums:url';

	/** The address is the only thing worth remembering, and it is not a secret. */
	const remembered = () => {
		try {
			return localStorage.getItem(URL_KEY) ?? '';
		} catch {
			return '';
		}
	};

	let url = $state(remembered() || untrack(() => auth.url));
	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let advanced = $state(false);

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			const res = await fetch('/api/auth', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ url, email, password })
			});
			const data = (await res.json()) as SignInResponse & { error?: string };
			if (!res.ok) throw new Error(data.error ?? res.statusText);
			try {
				localStorage.setItem(URL_KEY, url);
			} catch {
				// A private window forgets the address, which costs one retype.
			}
			password = '';
			onSignedIn();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="mx-auto flex w-full max-w-lg flex-col gap-4 py-10">
	<Card>
		<CardHeader>
			<CardTitle>Sign in to Immich</CardTitle>
			<CardDescription>
				Your password opens a session that lasts a day, and is never stored anywhere.
			</CardDescription>
		</CardHeader>
		<CardBody>
			<form onsubmit={signIn}>
				<Stack gap={4}>
					<Field label="Immich address">
						<Input bind:value={url} placeholder="http://nas:2283" autocomplete="url" />
					</Field>
					<Field label="Email">
						<Input bind:value={email} type="email" autocomplete="username" />
					</Field>
					<Field label="Password">
						<Input bind:value={password} type="password" autocomplete="current-password" />
					</Field>
					{#if auth.unreachable && url === auth.url && !error}
						<Text color="warning" size="tiny">{auth.unreachable}</Text>
					{/if}
					{#if !auth.passwordLogin}
						<Alert color="warning" title="This server signs in with OAuth">
							Immich here does not accept a password. Create an API key in Immich under Account
							Settings and put it in {auth.envFile} as IMMICH_API_KEY, then reload.
						</Alert>
					{/if}
					{#if error}
						<Alert color="danger" title="Not signed in">{error}</Alert>
					{/if}
					<HStack class="justify-between">
						<Button
							variant="ghost"
							size="tiny"
							leadingIcon={mdiCogOutline}
							onclick={() => (advanced = !advanced)}
						>
							Advanced
						</Button>
						<Button
							type="submit"
							leadingIcon={mdiLoginVariant}
							disabled={busy || !url || !email || !password}
						>
							{busy ? 'Signing in...' : 'Sign in'}
						</Button>
					</HStack>
					{#if advanced}
						<Text color="muted" size="tiny">
							A scheduled run has no one to type a password, so it reads IMMICH_API_KEY from
							{auth.envFile}. Sign in once, then use the key button in the header to create one.
						</Text>
					{/if}
				</Stack>
			</form>
		</CardBody>
	</Card>
</div>
