<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import { m } from '#lib/paraglide/messages.js';
	import ComingSoon from '#lib/ui/ComingSoon.svelte';
</script>

<ComingSoon
	icon={Activity}
	title={m.nav_activity()}
	description={m.activity_description()}
	planned={m.activity_planned()}
/>
