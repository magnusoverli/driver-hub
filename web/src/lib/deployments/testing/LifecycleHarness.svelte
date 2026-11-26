<!-- Test-only: provides an API client and a live deployment to the lifecycle dialog. -->
<script lang="ts">
	import type { ApiClient } from '#lib/api/client.js';
	import { setApi } from '#lib/api/context.js';
	import type { AppliedChange, LifecycleAction } from '../lifecycle.js';
	import LifecycleDialog from '../LifecycleDialog.svelte';
	import type { Deployment } from '../queries.js';
	import type { UpdateTarget } from '../view.js';

	type Props = {
		api: ApiClient;
		action: LifecycleAction;
		deployment: Deployment;
		/** What the deployment looks like after "reload", as if another operator changed it. */
		reloaded?: Deployment;
		targets?: UpdateTarget[];
		canApply?: boolean;
		onApplied?: (change: AppliedChange) => void;
	};

	let {
		api,
		action,
		deployment: initial,
		reloaded,
		targets = [],
		canApply = true,
		onApplied = () => {}
	}: Props = $props();
	// svelte-ignore state_referenced_locally
	setApi(api);
	let open = $state(true);
	// svelte-ignore state_referenced_locally
	let deployment = $state(initial);

	function reload() {
		if (reloaded) deployment = reloaded;
		return Promise.resolve();
	}
</script>

<LifecycleDialog
	bind:open
	{action}
	{deployment}
	{targets}
	{canApply}
	onReload={reload}
	{onApplied}
/>
<output data-testid="dialog-state">{open ? 'open' : 'closed'}</output>
