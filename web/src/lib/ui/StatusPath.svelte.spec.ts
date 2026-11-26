import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import StatusPath from './StatusPath.svelte';

describe('StatusPath', () => {
	it('announces every hop in words, not only colour', async () => {
		await render(StatusPath, {
			path: {
				requested: 'verified',
				allocation: 'verified',
				control: 'failed',
				approval: 'unknown'
			}
		});
		await expect
			.element(page.getByRole('img'))
			.toHaveAccessibleName(
				'Requested: verified, Allocation: verified, Control: failed, Approval: not observable'
			);
	});

	it('renders one segment per hop in order, styled by state', async () => {
		const screen = await render(StatusPath, {
			path: {
				requested: 'inactive',
				allocation: 'inactive',
				control: 'inactive',
				approval: 'unknown'
			}
		});
		const segments = [...screen.container.querySelectorAll('.segment')].map(
			(segment) => (segment as HTMLElement).dataset.state
		);
		expect(segments).toEqual(['inactive', 'inactive', 'inactive', 'unknown']);
	});
});
