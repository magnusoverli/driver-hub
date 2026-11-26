<script lang="ts">
	import Users from '@lucide/svelte/icons/users';
	import { m } from '#lib/paraglide/messages.js';
	import ComingSoon from '#lib/ui/ComingSoon.svelte';
</script>

<ComingSoon
	icon={Users}
	title={m.nav_users()}
	description={m.users_description()}
	planned={m.users_planned()}
/>
