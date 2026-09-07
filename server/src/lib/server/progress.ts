import type { Job } from '$lib/types';

/** One job at a time: the snapshot fetch and apply are both serialised anyway. */
let job: Job | null = null;

export function startJob(phase: Job['phase'], label: string, total = 0) {
	job = { phase, label, done: 0, total, startedAt: Date.now() };
}

export function setJob(patch: Partial<Job>) {
	if (job) Object.assign(job, patch);
}

export function endJob(error?: string) {
	if (job) job = { ...job, endedAt: Date.now(), error, done: error ? job.done : job.total || job.done };
}

/** Keeps a finished job around briefly, so the bar can land on 100% before it disappears. */
export function currentJob(): Job | null {
	if (job?.endedAt && Date.now() - job.endedAt > 4000) job = null;
	return job;
}
