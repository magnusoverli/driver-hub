<script lang="ts">
	import Layers from '@lucide/svelte/icons/layers';
	import { m } from '#lib/paraglide/messages.js';
	import ComingSoon from '#lib/ui/ComingSoon.svelte';
</script>

<ComingSoon
	icon={Layers}
	title={m.nav_deployments()}
	description={m.deployments_description()}
	planned={m.deployments_planned()}
/>
