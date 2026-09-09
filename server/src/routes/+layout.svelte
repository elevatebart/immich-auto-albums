<script lang="ts">
	import { Container, HStack, Logo, Text, ThemeSwitcher, TooltipProvider } from '@immich/ui';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();

	// ThemeSwitcher writes the class on toggle only. The stored choice, or the OS one when there is
	// none, goes on in the app.html head script so there is no light flash before hydration.
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
				<ThemeSwitcher size="small" />
			</HStack>
		</HStack>
	</Container>
</div>

<Container size="giant" center class="py-6">
	{@render children()}
</Container>
</TooltipProvider>
