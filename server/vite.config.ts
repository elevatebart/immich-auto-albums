import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node: the NAS target of roadmap item 3.
			adapter: adapter(),

			// The pure planner/reconcile/config modules live outside this app and are imported as source.
			alias: { $core: '../src' }
		})
	],
	// $core resolves above the SvelteKit root, so let the dev server read it.
	server: { fs: { allow: ['..'] } }
});
