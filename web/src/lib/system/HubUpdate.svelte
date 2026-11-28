<script lang="ts">
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { unwrap } from '#lib/api/client.js';
	import { isApiError, NETWORK_ERROR } from '#lib/api/errors.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { m } from '#lib/paraglide/messages.js';
	import Callout from '#lib/ui/Callout.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import ReleaseNotes from './ReleaseNotes.svelte';

	let { about = false }: { about?: boolean } = $props();
	const api = getApi(),
		client = useQueryClient(),
		session = getSession();
	const key = $derived(['hub-updates', session.operator?.username]);
	const active = (phase?: string) =>
		['downloading', 'restarting', 'verifying', 'rollingBack'].includes(phase ?? '');
	let watching = $state(false),
		dialog = $state(false),
		busy = $state(false),
		problem = $state('');
	let reviewed = $state('');
	const watchKey = $derived(`hub-update:${session.operator?.username}`);
	$effect(() => {
		const saved = sessionStorage.getItem(watchKey);
		if (saved) reviewed = saved;
	});
	const status = createQuery(() => ({
		queryKey: key,
		queryFn: () => unwrap(api.GET('/hub-updates')),
		retry: false,
		staleTime: 15000,
		refetchInterval: (q) => (watching || active(q.state.data?.operation?.phase) ? 2000 : 300000)
	}));
	const data = $derived(status.data),
		release = $derived(data?.candidate),
		op = $derived(data?.operation);
	const visible = $derived(release && (about || data?.ignored !== release.version));
	const pending = $derived(active(op?.phase));
	const verified = $derived(op?.phase === 'succeeded' && op.version === data?.installed);
	const phases: Record<string, () => string> = {
		downloading: m.update_pulling,
		restarting: m.update_restarting,
		verifying: m.update_verifying,
		rollingBack: m.update_rolling_back,
		rolledBack: m.update_rolled_back,
		recoveryRequired: m.update_recovery,
		failed: m.update_failed,
		succeeded: m.update_verified
	};
	async function act(action: 'ignore' | 'start' | 'check') {
		busy = true;
		problem = '';
		const params = { header: { 'X-Driver-Hub-Request': '1' as const } };
		try {
			if (action === 'check')
				client.setQueryData(key, await unwrap(api.POST('/hub-updates/check', { params })));
			else {
				const version = action === 'start' ? reviewed : release?.version;
				if (!version) return;
				if (action === 'start') {
					watching = true;
					sessionStorage.setItem(watchKey, version);
				}
				await unwrap(
					api.POST(action === 'start' ? '/hub-updates/start' : '/hub-updates/ignore', {
						body: { version },
						params
					})
				);
				dialog = false;
				await status.refetch();
			}
		} catch (e) {
			if (action === 'start' && isApiError(e, NETWORK_ERROR)) {
				// The host may already have accepted the update. Observe, never replay.
				dialog = false;
				void status.refetch();
				return;
			}
			watching = false;
			problem = e instanceof Error ? e.message : m.update_unavailable();
		} finally {
			busy = false;
		}
	}
	$effect(() => {
		if (watching && !status.isFetching && status.isSuccess && !active(op?.phase)) watching = false;
	});
</script>

{#if watching && status.error && !pending}
	<Callout live>{m.update_reconnecting()}</Callout>
{/if}
{#if pending || (op && (about || reviewed === op.version) && op.phase !== 'idle' && (op.phase !== 'succeeded' || verified))}
	<Callout
		title={`${phases[op?.phase ?? '']?.() ?? m.update_unavailable()} · ${op?.version}`}
		tone={op?.phase === 'succeeded' ? 'ok' : pending ? 'info' : 'warn'}
		live
	>
		{#if status.error && pending}{m.update_reconnecting()}{:else if op?.message}{op.message}{/if}
		{#if verified && import.meta.env.VITE_DRIVER_HUB_VERSION !== data?.installed}
			<Button size="sm" onclick={() => window.location.reload()}>{m.update_reload()}</Button>
		{/if}
	</Callout>
{/if}
{#if problem}<Callout tone="warn" live>{problem}</Callout>{/if}
{#if visible && release && !pending}
	<Callout title={m.update_available({ version: release.version })}>
		<details>
			<summary>{m.update_whats_new({ version: release.version })}</summary><ReleaseNotes
				text={release.notes || m.update_no_notes()}
			/>
		</details>
		{#if data?.checkError}<p>{m.update_unavailable()}</p>
		{:else if release.readiness === 'publishing'}<p>{m.update_publishing()}</p>
		{:else if !data?.managed || release.readiness === 'manual'}<p>{m.update_manual()}</p>{/if}
		<div class="actions">
			{#if data?.ignored !== release.version}<Button
					size="sm"
					disabled={busy}
					onclick={() => act('ignore')}
				>
					{m.update_ignore()}
				</Button>{/if}
			<Button
				size="sm"
				variant="primary"
				disabled={busy ||
					data?.checkError ||
					!data?.managed ||
					release.readiness !== 'ready' ||
					op?.phase === 'recoveryRequired'}
				onclick={() => {
					reviewed = release.version;
					dialog = true;
				}}
			>
				{m.update_button()}
			</Button>
		</div>
	</Callout>
{/if}
{#if about && !pending}
	<div class="actions">
		<Button size="sm" {busy} onclick={() => act('check')}>{m.update_check()}</Button>
		{#if status.error || data?.checkError}{m.update_unavailable()}
		{:else if data?.installed === 'development'}{m.about_local()}
		{:else if data && !release}{m.update_current()}{/if}
	</div>
{/if}
<Dialog
	bind:open={dialog}
	title={m.update_confirm({ version: reviewed })}
	description={m.update_interruption()}
>
	{#if problem}<Callout tone="warn" live>{problem}</Callout>{/if}
	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={() => (dialog = false)}>
			{m.common_cancel()}
		</Button>
		<Button variant="primary" {busy} onclick={() => act('start')}>{m.update_button()}</Button>
	{/snippet}
</Dialog>

<style>
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-block: var(--space-2);
	}
	summary {
		cursor: pointer;
		font-weight: var(--weight-semibold);
		padding-block: var(--space-2);
	}
</style>
