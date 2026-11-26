import type { Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';

// The manager's rules, so mistakes show next to the field before an upload or build starts.
const DRIVER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMERIC = '(?:0|[1-9][0-9]*)';
const PRE = `(?:${NUMERIC}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(
	`^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-${PRE}(?:\\.${PRE})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);
const COMMIT = /^[0-9a-f]{40}$/;
const BUILD_DIRECTORY = /^(Drivers|examples)(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+$/;

/** The largest compressed archive the manager accepts. */
export const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
/** The largest metadata part the manager accepts with an import. */
export const MAX_METADATA_BYTES = 256 * 1024;

export function driverIdProblem(value: string): string | null {
	if (!value.trim()) return m.catalog_error_driver_required();
	return DRIVER_ID.test(value.trim()) ? null : m.catalog_error_driver_format();
}

export function versionProblem(value: string): string | null {
	if (!value.trim()) return m.catalog_error_version_required();
	return SEMVER.test(value.trim()) ? null : m.catalog_error_version_format();
}

/** A full lowercase Git commit; optional where the source is only for reference. */
export function commitProblem(value: string, required: boolean): string | null {
	if (!value.trim()) return required ? m.catalog_error_commit_required() : null;
	return COMMIT.test(value.trim()) ? null : m.catalog_commit_hint();
}

/** A build reads a driver directory under Drivers/ or examples/ in the upstream repository. */
export function buildDirectoryProblem(value: string): string | null {
	if (!value.trim()) return m.catalog_error_directory_required();
	return BUILD_DIRECTORY.test(value.trim()) ? null : m.catalog_directory_hint();
}

export function archiveProblem(file: File | undefined): string | null {
	if (!file || !file.size || file.size > MAX_ARCHIVE_BYTES) return m.catalog_import_image_size();
	return null;
}

/** Parses an optional declaration. Blank is no declaration; malformed JSON is a problem. */
export function parseDeclaration(text: string): {
	declaration?: Schema<'Declaration'>;
	problem: string | null;
} {
	if (!text.trim()) return { problem: null };
	try {
		const value = JSON.parse(text) as Partial<Schema<'Declaration'>> | null;
		if (value?.schemaVersion !== 1 || !Array.isArray(value.inputs)) {
			return { problem: m.catalog_invalid_json() };
		}
		return { declaration: value as Schema<'Declaration'>, problem: null };
	} catch {
		return { problem: m.catalog_invalid_json() };
	}
}
