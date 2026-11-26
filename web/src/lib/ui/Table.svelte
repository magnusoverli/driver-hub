<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	type Props = {
		/** Names the table for assistive technology; also the label of its scroll region. */
		label: string;
		children: Snippet;
	};

	let { label, children }: Props = $props();

	/**
	 * When the table is wider than its card it scrolls sideways. Only then does the scroll area
	 * become a labelled, focusable region, so keyboard users can scroll it (WCAG 2.1.1) without
	 * an extra tab stop in the common case.
	 */
	const scrollableWhenOverflowing: Attachment<HTMLDivElement> = (element) => {
		const update = () => {
			if (element.scrollWidth > element.clientWidth + 1) {
				element.tabIndex = 0;
				element.setAttribute('role', 'region');
				element.setAttribute('aria-label', label);
			} else {
				element.removeAttribute('tabindex');
				element.removeAttribute('role');
				element.removeAttribute('aria-label');
			}
		};
		const observer = new ResizeObserver(update);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	};
</script>

<div class="table-scroll" {@attach scrollableWhenOverflowing}>
	<table>
		<caption class="visually-hidden">{label}</caption>
		{@render children()}
	</table>
</div>

<style>
	.table-scroll {
		overflow-x: auto;
	}

	.table-scroll:focus-visible {
		outline: none;
		box-shadow: inset var(--focus-ring);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	.table-scroll :global(th) {
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--border);
		color: var(--text-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		text-align: left;
		white-space: nowrap;
	}

	.table-scroll :global(td) {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	.table-scroll :global(tbody tr:last-child td) {
		border-bottom: 0;
	}

	/* Rows whose first link covers the whole row. */
	.table-scroll :global(tr[data-row-link]) {
		position: relative;
	}

	.table-scroll :global(tr[data-row-link]:hover) {
		background: var(--hover);
	}

	.table-scroll :global(tr[data-row-link] .row-link::after) {
		position: absolute;
		inset: 0;
		content: '';
	}

	.table-scroll :global(tr[data-row-link] .row-link:focus-visible) {
		outline: none;
	}

	.table-scroll :global(tr[data-row-link]:has(.row-link:focus-visible)) {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
</style>
