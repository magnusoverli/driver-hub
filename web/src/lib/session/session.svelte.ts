import { createContext } from 'svelte';
import type { AuthService, Operator } from './auth-service';

export type SessionStatus =
	/** Asking the manager whether the browser already has a session. */
	| 'restoring'
	/** The manager could not be reached while restoring; nothing is known yet. */
	| 'unavailable'
	| 'signed-out'
	| 'signed-in'
	/** The session ended underneath the open app. The operator is kept so they can resume. */
	| 'expired';

/** Why the last session ended, so the sign-in page can say so. */
export type SignOutReason = 'signed-out' | 'password-changed';

export interface SessionHooks {
	/** The cached data of the previous operator must not be shown to the next one. */
	onOperatorChanged?: () => void;
}

/** The operator's session. Components read its fields; only its methods change them. */
export class Session {
	status = $state<SessionStatus>('restoring');
	operator = $state<Operator | null>(null);
	lastSignOut = $state<SignOutReason | null>(null);

	readonly isAdmin = $derived(this.operator?.role === 'admin');
	/** Passwords of directory accounts (for example LDAP) are managed outside Hub. */
	readonly managesOwnPassword = $derived(this.operator?.provider === 'local');

	readonly #auth: AuthService;
	readonly #hooks: SessionHooks;

	constructor(auth: AuthService, hooks: SessionHooks = {}) {
		this.#auth = auth;
		this.#hooks = hooks;
	}

	async restore(): Promise<void> {
		this.status = 'restoring';
		try {
			this.operator = await this.#auth.current();
			this.status = this.operator ? 'signed-in' : 'signed-out';
		} catch {
			this.status = 'unavailable';
		}
	}

	/** Throws the backend's error when sign-in is refused; the session is then unchanged. */
	async signIn(username: string, password: string): Promise<void> {
		const operator = await this.#auth.signIn(username, password);
		if (this.operator && this.operator.username !== operator.username) {
			this.#hooks.onOperatorChanged?.();
		}
		this.operator = operator;
		this.lastSignOut = null;
		this.status = 'signed-in';
	}

	/** Called when the manager rejects the session of a signed-in operator. */
	expire(): void {
		if (this.status === 'signed-in') this.status = 'expired';
	}

	async signOut(): Promise<void> {
		try {
			await this.#auth.signOut();
		} finally {
			this.#end('signed-out');
		}
	}

	async changePassword(currentPassword: string | undefined, newPassword: string): Promise<void> {
		const operator = await this.#auth.changePassword(currentPassword, newPassword);
		if (operator) {
			this.operator = operator;
			this.status = 'signed-in';
		} else this.#end('password-changed');
	}

	#end(reason: SignOutReason): void {
		this.operator = null;
		this.lastSignOut = reason;
		this.status = 'signed-out';
		this.#hooks.onOperatorChanged?.();
	}
}

export const [getSession, setSession] = createContext<Session>();
