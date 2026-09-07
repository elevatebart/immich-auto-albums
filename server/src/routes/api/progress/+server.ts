import { json } from '@sveltejs/kit';
import { currentJob } from '$lib/server/progress';
import type { RequestHandler } from './$types';

/** What the server is busy with, for the progress bar. Cheap enough to poll. */
export const GET: RequestHandler = () => json({ job: currentJob() });
