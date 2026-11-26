<script lang="ts" module>
	export type Tone = 'neutral' | 'accent' | 'ok' | 'fail' | 'warn';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tone = 'neutral', children }: { tone?: Tone; children: Snippet } = $props();
</script>

<span class="badge" data-tone={tone}>{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		height: 1.25rem;
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
	}

	[data-tone='neutral'] {
		background: var(--sunken);
		color: var(--text-2);
	}

	[data-tone='accent'] {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	[data-tone='ok'] {
		background: var(--ok-soft);
		color: var(--ok);
	}

	[data-tone='fail'] {
		background: var(--fail-soft);
		color: var(--fail);
	}

	[data-tone='warn'] {
		background: var(--warn-soft);
		color: var(--warn);
	}
</style>
