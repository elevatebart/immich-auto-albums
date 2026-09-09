import type { Change, ChangeKind, ConfigDiff } from '$core/diff.js';

export const KIND_WORD: Record<ChangeKind, string> = {
	changed: 'changed',
	added: 'new',
	removed: 'removed'
};

export const KIND_COLOR: Record<ChangeKind, 'warning' | 'success' | 'danger'> = {
	changed: 'warning',
	added: 'success',
	removed: 'danger'
};

/** Left accent, transparent when nothing changed so the control keeps its indent either way. */
export const accent = (kind?: ChangeKind) => {
	const color =
		kind === 'added'
			? 'border-success'
			: kind === 'removed'
				? 'border-danger'
				: kind === 'changed'
					? 'border-warning'
					: 'border-transparent';
	return `border-s-2 ps-2 ${color}`;
};

/** A config value as one line of text, for the tooltip that says what it used to be. */
export function valueText(value: unknown): string {
	if (value === undefined || value === null || value === '') return 'empty';
	if (Array.isArray(value)) return value.length ? value.map(valueText).join(', ') : 'empty';
	if (typeof value === 'object') {
		const o = value as Record<string, unknown>;
		if ('km' in o) return `${o.name} (${o.lat}, ${o.lon}, ${o.km} km)`;
		if ('to' in o) return `${o.name} (${o.from} to ${o.to})`;
		if ('from' in o) return `${o.label ? `${o.label}, ` : ''}${o.from} (${o.lat}, ${o.lon})`;
		return Object.entries(o)
			.map(([k, v]) => `${k} ${valueText(v)}`)
			.join(', ');
	}
	return String(value);
}

const said = (change: Change) => (change.kind === 'added' ? 'new' : `was ${valueText(change.before)}`);

/** What changed at a path, or under it: `lat: was 45.05, km: was 12`. */
export function detailAt(diff: ConfigDiff, path: string): string {
	const own = diff.changes[path];
	if (own) return said(own);
	const below = Object.entries(diff.changes).filter(
		([p]) => p.startsWith(`${path}.`) || p.startsWith(`${path}[`)
	);
	const parts = below.map(([p, c]) => `${p.slice(path.length).replace(/^\./, '')}: ${said(c)}`);
	const gone = diff.gone[path]?.length;
	if (gone) parts.push(`${gone} removed`);
	return parts.join(', ');
}
