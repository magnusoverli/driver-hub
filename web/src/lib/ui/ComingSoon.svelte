<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import { m } from '#lib/paraglide/messages.js';
	import Card from './Card.svelte';
	import EmptyState from './EmptyState.svelte';
	import PageHeader from './PageHeader.svelte';

	type Props = { title: string; description: string; icon: LucideIcon; planned: string };

	let { title, description, icon, planned }: Props = $props();
</script>

<PageHeader {title} {description} />
<Card>
	<EmptyState {icon} title={m.coming_soon_title()}>
		<p>{planned}</p>
	</EmptyState>
</Card>
