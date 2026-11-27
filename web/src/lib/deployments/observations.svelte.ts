import type { DeploymentSummary } from './queries';
import { freshStatus, OBSERVATION_TTL_MS } from './status-path';

/** Recheck cached evidence only when the data changes or the next observation expires. */
export function freshObservations<
	T extends Pick<DeploymentSummary, 'communication' | 'communicationEvidence'>
>(read: () => T[]) {
	let expiry = $state(0);
	const rows = $derived.by(() => {
		const now = Math.max(Date.now(), expiry);
		return read().map((row) => freshStatus(row, now));
	});
	$effect(() => {
		let next = Infinity;
		for (const row of rows) {
			if (row.communication !== 'unknown' && row.communicationEvidence.observedAt) {
				next = Math.min(
					next,
					Date.parse(row.communicationEvidence.observedAt) + OBSERVATION_TTL_MS
				);
			}
		}
		if (!Number.isFinite(next)) return;
		const timer = setTimeout(() => (expiry = next), Math.max(0, next - Date.now()));
		return () => clearTimeout(timer);
	});
	return () => rows;
}
