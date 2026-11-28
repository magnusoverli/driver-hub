import { describe, expect, it } from 'vitest';
import {
	archiveProblem,
	buildDirectoryProblem,
	commitProblem,
	driverIdProblem,
	MAX_ARCHIVE_BYTES,
	parseDeclaration,
	versionProblem
} from './validation';

describe('catalog validation', () => {
	it('accepts driver IDs and versions the manager accepts', () => {
		expect(driverIdProblem('exampleco-meter')).toBeNull();
		expect(driverIdProblem('Example')).not.toBeNull();
		expect(driverIdProblem('double--hyphen')).not.toBeNull();
		expect(driverIdProblem('')).not.toBeNull();
		for (const version of ['1.0.0', '1.2.0-rc.1', '1.2.0+local', '0.0.0-local.abc']) {
			expect(versionProblem(version), version).toBeNull();
		}
		for (const version of ['1.0', '01.0.0', 'v1.0.0', '1.0.0-']) {
			expect(versionProblem(version), version).not.toBeNull();
		}
	});

	it('requires a full commit to build, and checks one given for reference', () => {
		expect(commitProblem('', false)).toBeNull();
		expect(commitProblem('', true)).not.toBeNull();
		expect(commitProblem('a'.repeat(40), true)).toBeNull();
		expect(commitProblem('A'.repeat(40), false)).not.toBeNull();
		expect(commitProblem('abc123', false)).not.toBeNull();
	});

	it('builds only from driver directories in the upstream repository', () => {
		expect(buildDirectoryProblem('Drivers/Vendor/Meter')).toBeNull();
		expect(buildDirectoryProblem('examples/rust_example')).toBeNull();
		expect(buildDirectoryProblem('src/meter')).not.toBeNull();
		expect(buildDirectoryProblem('Drivers/../etc')).not.toBeNull();
	});

	it('reads an optional declaration and explains a malformed one', () => {
		expect(parseDeclaration('  ')).toEqual({ problem: null });
		expect(parseDeclaration('{"schemaVersion":1,"inputs":[]}').declaration?.inputs).toEqual([]);
		expect(parseDeclaration('not json').problem).toMatch(/JSON object/);
		expect(parseDeclaration('{"schemaVersion":2,"inputs":[]}').declaration?.inputs).toEqual([]);
		expect(parseDeclaration('{"schemaVersion":3,"inputs":[]}').problem).toMatch(/JSON object/);
	});

	it('limits archives to what the manager accepts', () => {
		const file = (size: number) => ({ size }) as File;
		expect(archiveProblem(undefined)).not.toBeNull();
		expect(archiveProblem(file(0))).not.toBeNull();
		expect(archiveProblem(file(MAX_ARCHIVE_BYTES))).toBeNull();
		expect(archiveProblem(file(MAX_ARCHIVE_BYTES + 1))).not.toBeNull();
	});
});
