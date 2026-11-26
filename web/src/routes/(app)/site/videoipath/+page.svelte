<script lang="ts">
	import Link2 from '@lucide/svelte/icons/link-2';
	import { m } from '#lib/paraglide/messages.js';
	import ComingSoon from '#lib/ui/ComingSoon.svelte';
</script>

<ComingSoon
	icon={Link2}
	title={m.nav_videoipath()}
	description={m.videoipath_description()}
	planned={m.site_planned()}
/>
