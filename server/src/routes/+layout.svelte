<script lang="ts">
	import { page } from '$app/state';
	import { Container, HStack, Logo, Text, ThemeSwitcher, TooltipProvider } from '@immich/ui';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();

	const tabs = [
		{ href: '/', label: 'Preview' },
		{ href: '/config', label: 'Config' }
	];

	/** ThemeSwitcher writes the class on toggle only, so put the stored choice back on load. */
	onMount(() => {
		try {
			const pref = JSON.parse(localStorage.getItem('immich-ui-theme') ?? '""');
			if (pref === 'dark' || pref === 'light') {
				document.documentElement.classList.toggle('dark', pref === 'dark');
				document.documentElement.classList.toggle('light', pref === 'light');
			}
		} catch {
			// no stored preference, the system one applies
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<TooltipProvider>
<div class="border-b border-subtle bg-light">
	<Container size="giant" center>
		<HStack class="h-14 justify-between">
			<HStack gap={4}>
				<Logo variant="inline" class="h-6" />
				<Text color="muted" size="small">auto albums</Text>
			</HStack>
			<HStack gap={1}>
				{#each tabs as tab (tab.href)}
					<a
						href={tab.href}
						class="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-subtle"
						class:bg-subtle={page.url.pathname === tab.href}
						class:text-primary={page.url.pathname === tab.href}
						aria-current={page.url.pathname === tab.href ? 'page' : undefined}
					>
						{tab.label}
					</a>
				{/each}
				<ThemeSwitcher size="small" />
			</HStack>
		</HStack>
	</Container>
</div>

<Container size="giant" center class="py-6">
	{@render children()}
</Container>
</TooltipProvider>
