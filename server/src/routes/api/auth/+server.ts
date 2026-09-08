import { json } from '@sveltejs/kit';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import {
	ALBUM_KEY_PERMISSIONS,
	UNTESTED_PERMISSIONS,
	authMessage,
	createApiKey,
	serverFeatures,
	signIn,
	sweepSessions,
	verifyCredential
} from '$core/auth.js';
import { envFilePath, writeEnvKey } from '$core/env-file.js';
import { normalizeUrl } from '$core/immich.js';
import { account, credential, endSession, immichUrl, sessionToken, setSession, source } from '$lib/server/credentials';
import { configPath, PreviewError, readConfig } from '$lib/server/preview';
import type { AuthState, SaveKeyRequest, SignInRequest } from '$lib/types';
import type { RequestHandler } from './$types';

const fail = (e: unknown, status = 500) =>
	json({ error: (e as Error).message }, { status: e instanceof PreviewError ? e.status : status });

const envFile = () => envFilePath(configPath());

/** The directory has to be writable, since the write goes through a temp file next to the target. */
const writable = () =>
	access(path.dirname(envFile()), constants.W_OK).then(
		() => true,
		() => false
	);

const currentUrl = async () => {
	const cfg = await readConfig().catch(() => null);
	return cfg ? immichUrl(cfg) : (env.IMMICH_URL ?? 'http://localhost:2283');
};

/** Prefill and the sign in methods this Immich offers. Never returns a token or a key. */
export const GET: RequestHandler = async () => {
	const url = await currentUrl();
	const state: AuthState = {
		signedIn: Boolean(credential()),
		source: source(),
		email: account()?.email ?? null,
		expiresAt: account()?.expiresAt ?? null,
		url,
		passwordLogin: true,
		oauth: false,
		envFile: envFile(),
		envWritable: await writable(),
		demo: env.DEMO === '1'
	};
	try {
		Object.assign(state, await serverFeatures(url));
	} catch (e) {
		state.unreachable = authMessage(url, e);
	}
	return json(state);
};

/** Signs in and keeps the session in memory. `?key=1` mints an API key with that session instead. */
export const POST: RequestHandler = async ({ request, url }) => {
	if (url.searchParams.get('key') === '1') return mintKey();
	const body = (await request.json().catch(() => null)) as SignInRequest | null;
	const target = normalizeUrl(body?.url ?? '');
	if (!target || !body?.email || !body?.password) {
		return json({ error: 'url, email and password are all required' }, { status: 400 });
	}
	try {
		const session = await signIn(target, body.email, body.password);
		setSession(target, session);
		const swept = await sweepSessions(target, session.token);
		const verified = await verifyCredential(target, { kind: 'bearer', value: session.token });
		return json({ email: session.email, expiresAt: session.expiresAt, checks: verified.checks, swept });
	} catch (e) {
		return json({ error: authMessage(target, e) }, { status: 401 });
	}
};

async function mintKey() {
	const token = sessionToken();
	if (!token) return json({ error: 'Sign in first: a key is minted with your session.' }, { status: 409 });
	const url = await currentUrl();
	try {
		const name = `immich-auto-albums ${new Date().toISOString().slice(0, 10)}`;
		const secret = await createApiKey(url, token, name);
		const verified = await verifyCredential(url, { kind: 'key', value: secret });
		if (!verified.ok) {
			return json({ error: 'The new key was refused by one of the checks.', checks: verified.checks }, { status: 502 });
		}
		return json({
			secret,
			name,
			permissions: [...ALBUM_KEY_PERMISSIONS],
			untested: UNTESTED_PERMISSIONS,
			checks: verified.checks,
			envFile: envFile(),
			envWritable: await writable()
		});
	} catch (e) {
		return fail(new Error(authMessage(url, e)), 502);
	}
}

/** The Save button. Verifies the key it was handed before it reaches disk. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as SaveKeyRequest | null;
	if (!body?.secret) return json({ error: 'secret is required' }, { status: 400 });
	const url = await currentUrl();
	const verified = await verifyCredential(url, { kind: 'key', value: body.secret });
	if (!verified.ok) {
		return json({ error: 'That key does not work, so nothing was written.', checks: verified.checks }, { status: 400 });
	}
	try {
		return json(await writeEnvKey(envFile(), body.secret));
	} catch (e) {
		return json(
			{ error: `Cannot write ${envFile()}: ${(e as Error).message}. Copy the line instead.` },
			{ status: 500 }
		);
	}
};

/** Ends the session in Immich as well as here. */
export const DELETE: RequestHandler = async () => {
	await endSession();
	return json({ signedIn: false });
};
