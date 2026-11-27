import { m } from '#lib/paraglide/messages.js';
import type { Tone } from '#lib/ui/Badge.svelte';
import type { ImageDistribution } from './queries';

type State = ImageDistribution['state'];

const labels: Record<State, () => string> = {
	not_configured: m.images_state_not_configured,
	unavailable: m.images_state_unavailable,
	starting: m.images_state_starting,
	copying: m.images_state_copying,
	ready: m.images_state_ready,
	failing: m.images_state_failing
};

const tones: Record<State, Tone> = {
	not_configured: 'neutral',
	unavailable: 'fail',
	starting: 'neutral',
	copying: 'warn',
	ready: 'ok',
	failing: 'fail'
};

export const imageStateLabel = (state: State): string => labels[state]();
export const imageStateTone = (state: State): Tone => tones[state];

/** One sentence on whether drivers can get their images, for the overview and the Nomad page. */
export function imageDistributionSummary(images: ImageDistribution): string {
	switch (images.state) {
		case 'not_configured':
			return m.images_summary_not_configured();
		case 'unavailable':
			return m.images_summary_unavailable();
		case 'starting':
			return m.images_summary_starting();
		case 'copying':
			return m.images_summary_copying({ upToDate: images.upToDate, running: images.running });
		case 'ready':
			return m.images_summary_ready({ running: images.running });
		case 'failing': {
			const event = images.problems.find((problem) => problem.event)?.event;
			if (event) return m.images_summary_failing_clients({ count: images.problems.length, event });
			return m.images_summary_failing({ detail: images.detail ?? images.reason ?? '' });
		}
	}
}
