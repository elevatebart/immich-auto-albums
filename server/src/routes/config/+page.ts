import { redirect } from '@sveltejs/kit';

/** The config lives in the workspace now. */
export const load = () => redirect(308, '/');
