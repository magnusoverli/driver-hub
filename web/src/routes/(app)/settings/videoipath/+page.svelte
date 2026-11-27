<script lang="ts">
	import { untrack } from 'svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { unwrap } from '#lib/api/client.js';
	import type { ResponseBody } from '#lib/api/types.js';
	import { ApiError } from '#lib/api/errors.js';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { deviceName, shortId } from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import { siteProblem, type SiteProblem } from '#lib/site/problems.js';
	import {
		configureVideoIPath,
		parseTokens,
		removeToken,
		siteKeys,
		siteQuery,
		tokenProblem,
		videoIPathEndpoint,
		type Site,
		type VideoIPathInput
	} from '#lib/site/settings.js';
	import { capabilitiesQuery, systemKeys } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import CopyButton from '#lib/ui/CopyButton.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import Table from '#lib/ui/Table.svelte';
	import TextArea from '#lib/ui/TextArea.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	type Mode = Site['videoipath']['tokenMode'];

	const api = getApi();
	const queryClient = useQueryClient();
	const site = createQuery(() => siteQuery(api));
	const capabilities = createQuery(() => capabilitiesQuery(api));
	// Device names for the token assignments, when the cluster can report them.
	const deployments = createQuery(() => ({
		...deploymentsQuery(api),
		enabled: capabilities.data?.nomadConfigured === true
	}));
	const devices = $derived(new Map((deployments.data ?? []).map((d) => [d.nodeId, d])));

	let address = $state('');
	let mode = $state<Mode>('per-device');
	let tokens = $state('');
	let sharedToken = $state('');
	let revision = $state<number | null>(null);
	let attempted = $state(false);
	let busy = $state(false);
	let problem = $state<SiteProblem | null>(null);
	let saved = $state<string | null>(null);
	type Check = ResponseBody<'/site/videoipath/check', 'post'>;
	let check = $state<
		Check | { endpoint: string; state: 'checking' | 'unknown'; httpStatus: null } | null
	>(null);
	let checkSequence = 0;
	const checkMessage = {
		checking: m.videoipath_check_pending,
		auth_required: m.videoipath_check_auth,
		upgrade_required: m.videoipath_check_upgrade,
		not_found: m.videoipath_check_missing,
		unexpected: m.videoipath_check_unexpected,
		unreachable: m.videoipath_check_unreachable,
		tls_failed: m.videoipath_check_tls,
		timeout: m.videoipath_check_timeout,
		unknown: m.videoipath_check_unknown
	};

	async function checkSavedTarget(endpoint: string) {
		const sequence = ++checkSequence;
		check = { endpoint, state: 'checking', httpStatus: null };
		try {
			const result = await unwrap(api.POST('/site/videoipath/check'));
			if (sequence === checkSequence) check = result;
		} catch {
			if (sequence === checkSequence) check = { endpoint, state: 'unknown', httpStatus: null };
		}
	}

	type PoolToken = Site['videoipath']['pool'][number];
	let removing = $state<PoolToken | null>(null);
	let removeOpen = $state(false);
	let removeBusy = $state(false);
	let removeProblem = $state<string | null>(null);
	let removedNotice = $state<string | null>(null);

	async function confirmRemove() {
		if (!removing || !site.data) return;
		removeBusy = true;
		removeProblem = null;
		try {
			const result = await removeToken(api, removing.tokenFingerprint, site.data.revision);
			queryClient.setQueryData(siteKeys.settings(), result);
			// The form keeps what the operator typed; only the revision moves on.
			revision = result.revision;
			removedNotice = m.videoipath_token_removed({
				fingerprint: removing.tokenFingerprint.slice(0, 16)
			});
			removeOpen = false;
		} catch (error) {
			removeProblem = siteProblem(error).message;
			if (error instanceof ApiError && error.code === 'token_in_use') {
				removeProblem = m.videoipath_token_in_use();
			}
			void site.refetch();
		} finally {
			removeBusy = false;
		}
	}

	function fill(settings: Site) {
		address = settings.videoipath.url ?? '';
		mode = settings.videoipath.tokenMode;
		tokens = sharedToken = '';
		revision = settings.revision;
		attempted = false;
	}

	$effect(() => {
		const settings = site.data;
		if (settings && revision === null) untrack(() => fill(settings));
	});

	const current = $derived(site.data?.videoipath);
	$effect(() => {
		const url = current?.url;
		if (url)
			untrack(() => {
				if (check?.endpoint !== url) void checkSavedTarget(url);
			});
	});
	const endpointResponded = $derived(
		check?.state === 'auth_required' || check?.state === 'upgrade_required'
	);
	const endpoint = $derived(videoIPathEndpoint(address));
	/** The manager keeps the pool only for the same endpoint and mode; otherwise it starts anew. */
	const samePool = $derived(
		current?.url != null && endpoint === current.url && mode === current.tokenMode
	);
	const newTokens = $derived(parseTokens(tokens));
	const keepsShared = $derived(samePool && mode === 'shared' && current?.tokenConfigured === true);
	const changed = $derived(
		!samePool || (mode === 'per-device' ? newTokens.length > 0 : sharedToken.trim() !== '')
	);

	const addressError = $derived(attempted && !endpoint ? m.videoipath_error_address() : null);
	const tokensError = $derived.by(() => {
		if (!attempted || mode !== 'per-device') return null;
		if (!samePool && newTokens.length === 0) return m.videoipath_error_tokens_required();
		return newTokens.map(tokenProblem).find(Boolean) ?? null;
	});
	const sharedError = $derived(
		attempted && mode === 'shared' && !keepsShared ? tokenProblem(sharedToken.trim()) : null
	);

	const modeOptions = $derived([
		{
			value: 'per-device' as const,
			label: m.videoipath_mode_per_device(),
			description: m.videoipath_mode_per_device_description()
		},
		{
			value: 'shared' as const,
			label: m.videoipath_mode_shared(),
			description: m.videoipath_mode_shared_description()
		}
	]);

	function input(): VideoIPathInput {
		const body: VideoIPathInput = {
			revision: revision ?? 0,
			address: address.trim(),
			tokenMode: mode
		};
		if (mode === 'per-device') body.tokens = newTokens;
		else if (sharedToken.trim()) body.token = sharedToken.trim();
		return body;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		problem = saved = null;
		if (!endpoint || tokensError || sharedError || revision === null) return;
		if (mode === 'per-device' && !samePool && newTokens.length === 0) return;
		busy = true;
		try {
			const previousCount = samePool ? (current?.pool.length ?? 0) : 0;
			const result = await configureVideoIPath(api, input());
			queryClient.setQueryData(siteKeys.settings(), result);
			fill(result);
			const added = result.videoipath.pool.length - previousCount;
			saved = added > 0 ? m.videoipath_saved_tokens({ count: added }) : m.videoipath_saved();
			void queryClient.invalidateQueries({ queryKey: systemKeys.all });
			if (result.videoipath.url) await checkSavedTarget(result.videoipath.url);
		} catch (error) {
			problem = siteProblem(error);
			if (problem.kind === 'conflict') {
				const fresh = await site.refetch();
				if (fresh.data) fill(fresh.data);
			}
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={m.nav_videoipath()} description={m.videoipath_description()} />

{#if site.error}
	<Callout tone="fail" title={m.site_error_title()} live>{site.error.message}</Callout>
{:else if !site.data || !current}
	<Card><Loading label={m.site_loading()} /></Card>
{:else}
	<div class="layout">
		<div class="column">
			{#if removedNotice}<Callout title={removedNotice} live>
					{m.videoipath_token_revoke()}
				</Callout>{/if}
			<Card title={m.videoipath_current_title()}>
				{#if current.url && check && check.endpoint === current.url}
					<Callout
						tone={check.state === 'checking' ? 'info' : endpointResponded ? 'ok' : 'warn'}
						title={check.state === 'checking'
							? m.videoipath_status_checking()
							: endpointResponded
								? m.videoipath_status_reachable()
								: m.videoipath_status_problem()}
						live
					>
						{checkMessage[check.state]({ endpoint: check.endpoint, code: check.httpStatus ?? '—' })}
					</Callout>
				{/if}
				<Facts>
					<dt>{m.videoipath_endpoint()}</dt>
					<dd>
						{#if current.url}<code>{current.url}</code>{:else}{m.site_not_set()}{/if}
					</dd>
					<dt>{m.videoipath_mode()}</dt>
					<dd>
						{current.tokenMode === 'shared'
							? m.videoipath_mode_shared()
							: m.videoipath_mode_per_device()}
					</dd>
					<dt>{m.videoipath_pool()}</dt>
					<dd>
						{#if !current.url}
							{m.site_not_set()}
						{:else if current.tokenMode === 'shared'}
							{current.tokenConfigured ? m.site_token_saved() : m.site_token_none()}
						{:else}
							{m.videoipath_pool_counts({
								available: current.availableTokens ?? 0,
								assigned: current.assignments.length
							})}
						{/if}
					</dd>
				</Facts>
				{#if current.url && current.tokenMode === 'per-device' && current.availableTokens === 0}
					<div class="spaced">
						<Callout tone="warn" title={m.videoipath_pool_empty_title()}>
							{m.videoipath_pool_empty_body()}
						</Callout>
					</div>
				{/if}
				{#if current.url}
					<div class="footnote">
						<Button
							disabled={busy || check?.state === 'checking'}
							onclick={() => current?.url && checkSavedTarget(current.url)}
						>
							{m.videoipath_check_again()}
						</Button>
					</div>
				{/if}
			</Card>

			{#if current.tokenMode === 'per-device' && current.pool.length}
				<Card
					title={m.videoipath_pool_title()}
					description={m.videoipath_assignments_description()}
					flush
				>
					<Table label={m.videoipath_pool_title()}>
						<thead>
							<tr>
								<th scope="col">{m.videoipath_assignment_fingerprint()}</th>
								<th scope="col">{m.videoipath_token_status()}</th>
								<th scope="col"><span class="visually-hidden">{m.users_column_actions()}</span></th>
							</tr>
						</thead>
						<tbody>
							{#each current.pool as token (token.tokenFingerprint)}
								{@const device = token.nodeId ? devices.get(token.nodeId) : undefined}
								{@const gone = token.nodeId !== null && deployments.isSuccess && !device}
								<tr>
									<td>
										<span class="fingerprint">
											<code title={token.tokenFingerprint}>
												{token.tokenFingerprint.slice(0, 16)}…
											</code>
											<CopyButton
												value={token.tokenFingerprint}
												label={m.videoipath_copy_fingerprint()}
											/>
										</span>
									</td>
									<td>
										{#if token.nodeId === null}
											{m.videoipath_token_unused()}
										{:else if gone}
											<span class="gone">
												{m.videoipath_token_deleted({ nodeId: shortId(token.nodeId) })}
											</span>
										{:else}
											{m.videoipath_token_reserved()}
											<a href={resolve('/(app)/deployments/[nodeId]', { nodeId: token.nodeId })}>
												{device ? deviceName(device) : shortId(token.nodeId)}
											</a>
										{/if}
									</td>
									<td class="action">
										{#if token.nodeId === null || gone}
											<IconButton
												size="sm"
												icon={Trash2}
												label={m.videoipath_token_remove_label({
													fingerprint: token.tokenFingerprint.slice(0, 16)
												})}
												onclick={() => {
													removing = token;
													removeOpen = true;
												}}
											/>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				</Card>
			{/if}
		</div>

		<Card title={m.videoipath_form_title()} description={m.videoipath_form_description()}>
			<form class="form" onsubmit={submit} novalidate>
				{#if problem}
					<Callout tone={problem.kind === 'conflict' ? 'warn' : 'fail'} live>
						{problem.message}
					</Callout>
				{/if}
				<TextField
					label={m.videoipath_address()}
					bind:value={address}
					placeholder="vip.site.example"
					autocomplete="off"
					spellcheck={false}
					hint={endpoint
						? m.videoipath_address_resolved({ endpoint })
						: m.videoipath_address_hint()}
					error={addressError}
				/>
				<RadioGroup legend={m.videoipath_mode()} options={modeOptions} bind:value={mode} />
				{#if mode === 'per-device'}
					<TextArea
						label={samePool ? m.videoipath_tokens_add() : m.videoipath_tokens_new()}
						bind:value={tokens}
						code
						spellcheck={false}
						autocomplete="off"
						hint={newTokens.length
							? m.videoipath_tokens_count({ count: newTokens.length })
							: m.videoipath_tokens_hint()}
						error={tokensError}
					/>
				{:else}
					<TextField
						label={m.videoipath_shared_token()}
						type="password"
						autocomplete="off"
						bind:value={sharedToken}
						hint={keepsShared ? m.videoipath_shared_keep_hint() : m.videoipath_shared_hint()}
						error={sharedError}
					/>
				{/if}
				{#if current.url && !samePool && endpoint}
					<Callout tone="warn" title={m.videoipath_new_pool_title()}>
						{m.videoipath_new_pool_body()}
					</Callout>
				{/if}
				<div class="submit">
					<Button variant="primary" type="submit" {busy} disabled={!changed}>
						{m.videoipath_submit()}
					</Button>
					<span class="note">{m.videoipath_submit_note()}</span>
				</div>
				{#if saved}
					<Callout tone="ok" title={saved} live />
				{/if}
			</form>
		</Card>
	</div>
{/if}

{#if removing}
	<ConfirmDialog
		bind:open={removeOpen}
		title={m.videoipath_token_remove_title({ fingerprint: removing.tokenFingerprint.slice(0, 16) })}
		confirmLabel={m.videoipath_token_remove_confirm()}
		busy={removeBusy}
		problem={removeProblem}
		onConfirm={confirmRemove}
	>
		<p>{m.videoipath_token_remove_body()}</p>
		{#if removing.nodeId}<p>{m.videoipath_token_remove_deleted()}</p>{/if}
	</ConfirmDialog>
{/if}

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(18rem, 1fr) minmax(0, 1.6fr);
		align-items: start;
		gap: var(--space-5);
	}

	@media (max-width: 68rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.column,
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.column {
		gap: var(--space-5);
		min-width: 0;
	}

	.gone {
		color: var(--text-2);
	}

	.action {
		text-align: right;
	}

	.fingerprint {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.submit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.spaced {
		margin-top: var(--space-4);
	}

	.note,
	.footnote {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.footnote {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border);
	}
</style>
