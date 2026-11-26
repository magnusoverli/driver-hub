<script lang="ts">
	import Server from '@lucide/svelte/icons/server';
	import { m } from '#lib/paraglide/messages.js';
	import ComingSoon from '#lib/ui/ComingSoon.svelte';
</script>

<ComingSoon
	icon={Server}
	title={m.nav_nomad()}
	description={m.nomad_description()}
	planned={m.site_planned()}
/>
