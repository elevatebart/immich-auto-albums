import { env } from '$env/dynamic/private';
import { signOut, type Session } from '$core/auth.js';
import type { Config, Credential } from '$core/types.js';

/** The signed in session lives here and nowhere else: never on disk, never in the browser. */
let session: Session | null = null;
let sessionUrl: string | null = null;

export type CredentialSource = 'session' | 'env' | 'none';

export const source = (): CredentialSource => (session ? 'session' : env.IMMICH_API_KEY ? 'env' : 'none');

export function credential(): Credential | null {
	if (session) return { kind: 'bearer', value: session.token };
	return env.IMMICH_API_KEY ? { kind: 'key', value: env.IMMICH_API_KEY } : null;
}

/** A session was signed in against a URL the user typed, which wins over config and environment. */
export const immichUrl = (cfg: Config) => sessionUrl ?? env.IMMICH_URL ?? cfg.immich.url;

export const account = () => (session ? { email: session.email, expiresAt: session.expiresAt } : null);

export const sessionToken = () => session?.token ?? null;

export function setSession(url: string, next: Session) {
	session = next;
	sessionUrl = url;
}

export async function endSession() {
	if (session && sessionUrl) await signOut(sessionUrl, session);
	session = null;
	sessionUrl = null;
}

// The session is temporary, so it goes when the process does rather than lingering in Immich.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.once(signal, () => void endSession().finally(() => process.exit(0)));
}
