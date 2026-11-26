<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import { m } from '#lib/paraglide/messages.js';
	import ComingSoon from '#lib/ui/ComingSoon.svelte';
</script>

<ComingSoon
	icon={Package}
	title={m.nav_catalog()}
	description={m.catalog_description()}
	planned={m.catalog_planned()}
/>
