import type { Schema } from '#lib/api/types.js';

export type Declaration = Schema<'Declaration'>;
export type DeclaredInput = Declaration['inputs'][number];

/** Who fills an input in when a device is set up: the operator, Hub (node ID) or the site. */
export type InputSource = 'operator' | 'identity' | 'site';

export function inputSource(declaration: Declaration, input: DeclaredInput): InputSource {
	if (input.name === declaration.nodeIdInput || input.env === 'VIDEOIPATH_NODE_ID') {
		return 'identity';
	}
	const mapping = declaration.videoIPathInputs ?? {};
	if (
		input.name === mapping.url ||
		input.name === mapping.token ||
		input.env === 'VIDEOIPATH_URL' ||
		input.env === 'VIDEOIPATH_TOKEN'
	) {
		return 'site';
	}
	return 'operator';
}

/** What an operator has to enter for a device: inputs without a default that Hub cannot fill. */
export function requiredOperatorInputs(declaration: Declaration): DeclaredInput[] {
	return declaration.inputs.filter(
		(input) =>
			input.required &&
			input.default === undefined &&
			inputSource(declaration, input) === 'operator'
	);
}
