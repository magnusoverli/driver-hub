import type { QueryClient } from '@tanstack/svelte-query';
import type { ApiClient } from '#lib/api/client.js';
import { errorMessage } from '#lib/api/messages.js';
import {
	operationKeys,
	operationOutcome,
	type Operation,
	type OperationOutcome
} from '#lib/operations/operations.js';
import { m } from '#lib/paraglide/messages.js';
import { acquire } from './acquire';
import { catalogKeys, type BuildInput, type Identity } from './queries';

type Options = {
	api: ApiClient;
	client: QueryClient;
	/** The current background operations, to follow the one started here until it ends. */
	operations: () => readonly Operation[] | undefined;
	/** Whether the manager runs downloads and builds in the background. */
	background: () => boolean;
};

/**
 * Downloads and builds started from a page, and what to tell the operator about the latest one.
 * Activity keeps the full history.
 */
export class Acquisitions {
	submitting = $state(false);
	problem = $state<string | null>(null);
	notice = $state<string | null>(null);
	#started = $state<Operation | null>(null);
	#options: Options;

	constructor(options: Options) {
		this.#options = options;
	}

	/** The started operation's progress or result, as it changes. */
	get outcome(): OperationOutcome | null {
		const started = this.#started;
		if (!started) return null;
		const current = this.#options.operations()?.find((op) => op.id === started.id);
		return operationOutcome(current ?? started);
	}

	clear() {
		this.problem = this.notice = this.#started = null;
	}

	/** Shows a message instead of the last operation's outcome. */
	tell(message: string) {
		this.clear();
		this.notice = message;
	}

	async start(input: Identity | BuildInput) {
		if (this.submitting) return;
		const { api, client, background } = this.#options;
		this.submitting = true;
		this.clear();
		try {
			const result = await acquire(api, input, background());
			if (result.kind === 'operation') {
				this.#started = result.operation;
				await client.invalidateQueries({ queryKey: operationKeys.all });
			} else {
				const { driverId: driver, version } = result.release.record;
				this.notice =
					'commit' in input
						? m.catalog_build_done({ driver, version })
						: m.catalog_download_done({ driver, version });
				await client.invalidateQueries({ queryKey: catalogKeys.retained() });
			}
		} catch (error) {
			this.problem = errorMessage(error);
		} finally {
			this.submitting = false;
		}
	}
}
