<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import { isActive, type NavItem, type NavSection } from './navigation';

	type Props = {
		items: NavItem[];
		routeId: string | null;
		/** Work in progress per item, such as running downloads on Activity. */
		counts?: Partial<Record<string, number>>;
	};

	let { items, routeId, counts = {} }: Props = $props();

	// The site's own administration sits apart from the everyday sections.
	const sections = $derived(
		(['main', 'site'] as NavSection[])
			.map((section) => ({ section, items: items.filter((item) => item.section === section) }))
			.filter((group) => group.items.length > 0)
	);
</script>

<nav class="side-nav" aria-label={m.nav_label()}>
	{#each sections as group (group.section)}
		<div class={['group', { site: group.section === 'site' }]}>
			<ul>
				{#each group.items as item (item.id)}
					{@const Icon = item.icon}
					{@const active = isActive(item, routeId)}
					<li>
						<a
							href={resolve(item.route)}
							class={{ active }}
							aria-current={active ? 'page' : undefined}
						>
							<Icon size={16} aria-hidden="true" />
							<span>{item.label()}</span>
							{#if counts[item.id]}
								<span class="count" aria-hidden="true">{counts[item.id]}</span>
								<span class="visually-hidden">
									{m.nav_running({ count: counts[item.id] ?? 0 })}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</nav>

<style>
	.side-nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding-top: var(--space-1);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.site {
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--control);
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--text-2);
		font-weight: var(--weight-medium);
		text-decoration: none;
		transition:
			background-color var(--duration-fast) var(--ease),
			color var(--duration-fast) var(--ease);
	}

	a:hover {
		background: var(--hover);
		color: var(--text);
	}

	a.active {
		background: var(--accent-soft);
		color: var(--accent-text);
		font-weight: var(--weight-semibold);
	}

	.count {
		margin-left: auto;
		min-width: 1.25rem;
		padding: 0 var(--space-1);
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-ink);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	a:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
</style>
