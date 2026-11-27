import type { RetainedRelease } from '#lib/catalog/queries.js';
import { m } from '#lib/paraglide/messages.js';
import { formatTimestamp } from '#lib/time/format.js';
import type { CommunicationEvidence, DeploymentSummary, UpdateSuggestion } from './queries';
import { statusPath, type Hop, type StatusInput } from './status-path';

/** One word for where a deployment stands, derived from its status path. */
export type Condition =
	/** Nomad could not report the deployment just now. */
	| 'unavailable'
	| 'stopped'
	| 'allocation-failed'
	/** Asked to run, but its allocation is not running (yet). */
	| 'starting'
	| 'check-failed'
	/** The driver's control check reports VideoIPath and the device connected. */
	| 'connected'
	/** Running, without evidence about control either way. */
	| 'running';

export function condition(input: StatusInput): Condition {
	if (input.requested === null) return 'unavailable';
	const path = statusPath(input);
	if (path.requested === 'inactive') return 'stopped';
	if (path.allocation === 'failed') return 'allocation-failed';
	if (path.allocation === 'pending') return 'starting';
	if (path.control === 'failed') return 'check-failed';
	return path.control === 'verified' ? 'connected' : 'running';
}

const attention = new Set<Condition>(['unavailable', 'allocation-failed', 'check-failed']);

/** Conditions an operator should look at: Hub has evidence of a failure, or no status at all. */
export function needsAttention(value: Condition): boolean {
	return attention.has(value);
}

const conditionLabels: Record<Condition, () => string> = {
	unavailable: m.condition_unavailable,
	stopped: m.condition_stopped,
	'allocation-failed': m.condition_allocation_failed,
	starting: m.condition_starting,
	'check-failed': m.condition_check_failed,
	connected: m.condition_connected,
	running: m.condition_running
};

export function conditionLabel(value: Condition): string {
	return conditionLabels[value]();
}

type Named = Pick<DeploymentSummary, 'label' | 'nodeId'>;

export function deviceName(deployment: Named): string {
	return deployment.label ?? m.deployment_unnamed();
}

/** The first block of a node UUID, enough to tell devices apart at a glance. */
export function shortId(id: string): string {
	return id.slice(0, 8);
}

/** The digest of a pinned image reference, which identifies its exact content. */
export function imageDigest(image: string): string {
	const at = image.lastIndexOf('@');
	return at === -1 ? image : image.slice(at + 1);
}

/** Abbreviates "sha256:<64 hex>" to its first 12 hex digits, as container tools do. */
export function shortDigest(digest: string): string {
	return digest.replace(/^(sha256:[0-9a-f]{12})[0-9a-f]+$/, '$1');
}

/** Named devices first, alphabetically, then unnamed ones by node ID; stable as status changes. */
export function sortByName<T extends Named>(rows: readonly T[]): T[] {
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return [...rows].sort((a, b) => {
		if (a.label !== null && b.label !== null) {
			return collator.compare(a.label, b.label) || a.nodeId.localeCompare(b.nodeId);
		}
		if (a.label !== b.label) return a.label === null ? 1 : -1;
		return a.nodeId.localeCompare(b.nodeId);
	});
}

export const DEPLOYMENT_FILTERS = ['all', 'attention', 'running', 'stopped'] as const;
export type DeploymentFilter = (typeof DEPLOYMENT_FILTERS)[number];

export function matchesFilter(row: DeploymentSummary, filter: DeploymentFilter): boolean {
	switch (filter) {
		case 'attention':
			return needsAttention(condition(row));
		case 'running':
			return row.requested === 'running';
		case 'stopped':
			return row.requested === 'stopped';
		default:
			return true;
	}
}

/** Matches the name, node ID, driver, version or host, ignoring case. */
export function matchesSearch(row: DeploymentSummary, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	return [row.label, row.nodeId, row.driverId, row.version, row.allocation?.host].some((value) =>
		value?.toLocaleLowerCase().includes(needle)
	);
}

const evidenceReasons: Record<string, () => string> = {
	stopped: m.evidence_stopped,
	no_control_check: m.evidence_no_control_check,
	no_single_current_allocation: m.evidence_no_single_current_allocation,
	check_unavailable: m.evidence_check_unavailable,
	no_observation: m.evidence_no_observation,
	stale_observation: m.evidence_stale_observation,
	check_pending: m.evidence_check_pending,
	status_unavailable: m.evidence_status_unavailable,
	job_unavailable: m.evidence_job_unavailable
};

/** Why Hub does or does not have evidence of control, in the operator's words. */
export function evidenceText(evidence: CommunicationEvidence): string {
	const time = evidence.observedAt ? formatTimestamp(evidence.observedAt) : undefined;
	if (evidence.state === 'driver-reports-connected') {
		return time ? m.evidence_connected_at({ time }) : m.evidence_connected();
	}
	if (evidence.state === 'check-failed') {
		return time ? m.evidence_failed_at({ time }) : m.evidence_failed();
	}
	return evidenceReasons[evidence.reason]?.() ?? m.evidence_other({ reason: evidence.reason });
}

type Version = { core: bigint[]; pre: string[] };

function parseVersion(value: string): Version {
	const [withoutBuild] = value.split('+', 1);
	const dash = withoutBuild.indexOf('-');
	const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)).split('.');
	return {
		core: core.map((part) => (/^\d+$/.test(part) ? BigInt(part) : 0n)),
		pre: dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.')
	};
}

/** Orders two SemVer versions by precedence: negative when a comes first. Ignores build metadata. */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
		const difference = (left.core[i] ?? 0n) - (right.core[i] ?? 0n);
		if (difference !== 0n) return difference < 0n ? -1 : 1;
	}
	// A release without prerelease identifiers ranks above its prereleases.
	if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length;
	for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
		const x = left.pre[i];
		const y = right.pre[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const numeric = /^\d+$/;
		if (numeric.test(x) && numeric.test(y)) return BigInt(x) < BigInt(y) ? -1 : 1;
		if (numeric.test(x) !== numeric.test(y)) return numeric.test(x) ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

export interface UpdateTarget {
	version: string;
	displayName: string;
	/** "maintainer" for published releases, "customer" for site builds. */
	origin: string;
	newer: boolean;
}

/**
 * The retained versions a deployment can switch to: the same driver, any other version, newest
 * first. Customer builds are listed but never counted as newer, as the manager does.
 */
export function updateTargets(
	deployment: Pick<DeploymentSummary, 'driverId' | 'version'>,
	retained: readonly RetainedRelease[]
): UpdateTarget[] {
	const isBuild = (version: string) => version.startsWith('0.0.0-local.');
	return retained
		.filter((release) => release.driverId === deployment.driverId)
		.filter((release) => release.version !== deployment.version)
		.map((release) => ({
			version: release.version,
			displayName: release.displayName,
			origin: release.origin,
			newer:
				!isBuild(release.version) &&
				!isBuild(deployment.version) &&
				compareVersions(release.version, deployment.version) > 0
		}))
		.sort((a, b) => compareVersions(b.version, a.version));
}

type HopInput = StatusInput & { communicationEvidence: CommunicationEvidence };

/** One sentence per hop saying what Hub observed, for the detail view. */
export function hopExplanations(input: HopInput): Record<Hop, string> {
	const { requested, allocation, communicationEvidence } = input;
	const path = statusPath(input);
	const host = allocation?.host ?? m.hop_unknown_host();
	let allocationText: string;
	if (path.allocation === 'inactive') allocationText = m.hop_allocation_inactive();
	else if (path.allocation === 'unknown') allocationText = m.hop_allocation_unknown();
	else if (!allocation) allocationText = m.hop_allocation_unplaced();
	else if (path.allocation === 'verified') {
		allocationText = allocation.restarts
			? m.hop_allocation_running_restarts({ host, count: allocation.restarts })
			: m.hop_allocation_running({ host });
	} else if (path.allocation === 'failed') {
		allocationText = m.hop_allocation_failed({ host, status: allocation.status });
	} else allocationText = m.hop_allocation_waiting({ host, status: allocation.status });

	return {
		requested:
			requested === 'running'
				? m.hop_requested_running()
				: requested === 'stopped'
					? m.hop_requested_stopped()
					: m.hop_requested_unknown(),
		allocation: allocationText,
		control: evidenceText(communicationEvidence),
		approval: m.hop_approval()
	};
}

export const MAX_LABEL_LENGTH = 80;

/** Mirrors the manager's rule: 1–80 characters after trimming, without control characters. */
export function labelProblem(value: string): string | null {
	const label = value.trim();
	if (!label) return m.rename_error_empty();
	if ([...label].length > MAX_LABEL_LENGTH) return m.rename_error_long({ count: MAX_LABEL_LENGTH });
	if (/\p{Cc}/u.test(label)) return m.rename_error_control();
	return null;
}

/** The newest version a device could move to: retained here, or only published upstream. */
export type UpdateHint = { version: string; retained: boolean };

/**
 * Per device, the newest version worth mentioning in the list. A retained newer version can be
 * deployed right away; a newer upstream version has to be downloaded first.
 */
export function updateHints(
	rows: readonly Pick<DeploymentSummary, 'nodeId' | 'driverId' | 'version'>[],
	suggestions: readonly UpdateSuggestion[],
	retained: readonly RetainedRelease[]
): Map<string, UpdateHint> {
	const published = new Map(suggestions.map((s) => [s.nodeId, s.availableVersion]));
	const hints = new Map<string, UpdateHint>();
	for (const row of rows) {
		const ready = updateTargets(row, retained).find((target) => target.newer)?.version;
		const upstream = published.get(row.nodeId);
		if (upstream && (!ready || compareVersions(upstream, ready) > 0)) {
			hints.set(row.nodeId, {
				version: upstream,
				retained: retained.some(
					(release) => release.driverId === row.driverId && release.version === upstream
				)
			});
		} else if (ready) {
			hints.set(row.nodeId, { version: ready, retained: true });
		}
	}
	return hints;
}

/** The address query that restores a list view, such as "?q=meter&show=attention". */
export function filterQuery(search: string, filter: DeploymentFilter): string {
	const params = [] as string[];
	const query = search.trim();
	if (query) params.push(`q=${encodeURIComponent(query)}`);
	if (filter !== 'all') params.push(`show=${filter}`);
	return params.length ? `?${params.join('&')}` : '';
}
