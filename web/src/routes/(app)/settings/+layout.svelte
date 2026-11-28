<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { isActive, settingsNavigation, visibleNavigation } from '#lib/shell/navigation.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const session = getSession();
	const groups = $derived(settingsNavigation(visibleNavigation(session.operator?.role)));
</script>

<div class="settings">
	{#if groups.length}
		<nav class="subnav" aria-label={m.settings_nav_label()}>
			{#each groups as group (group.id)}
				<div class="group">
					<!-- A group of one page is named by the page itself. -->
					{#if group.items.length > 1}<span class="heading">{group.label()}</span>{/if}
					<ul>
						{#each group.items as item (item.id)}
							{@const Icon = item.icon}
							{@const active = isActive(item, page.route.id)}
							<li>
								<a
									href={resolve(item.route)}
									class={{ active }}
									aria-current={active ? 'page' : undefined}
								>
									<Icon size={15} aria-hidden="true" />
									<span>{item.label()}</span>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>
	{/if}
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.settings {
		display: grid;
		grid-template-columns: 12rem minmax(0, 1fr);
		align-items: start;
		gap: var(--space-6);
	}

	/* Settings pages lay out their columns by the space left beside this navigation. */
	.content {
		container: settings / inline-size;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}

	.subnav {
		position: sticky;
		top: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding-top: var(--space-2);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.heading {
		padding: 0 var(--space-3);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: 0.04em;
		text-transform: uppercase;
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
		gap: var(--space-2);
		min-height: calc(var(--control) - 4px);
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		text-decoration: none;
	}

	a:hover {
		background: var(--hover);
		color: var(--text);
	}

	a.active {
		background: var(--surface);
		box-shadow: var(--ring);
		color: var(--text);
		font-weight: var(--weight-semibold);
	}

	a:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	/* On narrow screens the pages wrap across the top, so the current one always shows. */
	@media (max-width: 68rem) {
		.settings {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-4);
		}

		.subnav {
			position: static;
			flex-flow: row wrap;
			gap: var(--space-1);
			padding: 0 0 var(--space-3);
			border-bottom: 1px solid var(--border);
		}

		.group,
		ul {
			display: contents;
		}

		.heading {
			display: none;
		}

		a {
			white-space: nowrap;
		}
	}
</style>
