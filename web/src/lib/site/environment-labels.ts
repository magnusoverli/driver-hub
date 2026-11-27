import { m } from '#lib/paraglide/messages.js';
import type { EnvironmentSetting } from './settings';

const labels: Record<string, () => string> = {
	HOST: m.env_HOST,
	PORT: m.env_PORT,
	DRIVER_HUB_DATA_DIR: m.env_DRIVER_HUB_DATA_DIR,
	DRIVER_HUB_DISTRIBUTION_PORT: m.env_DRIVER_HUB_DISTRIBUTION_PORT,
	DRIVER_HUB_DISTRIBUTION_ADDRESS: m.env_DRIVER_HUB_DISTRIBUTION_ADDRESS,
	DRIVER_HUB_WEB_DIR: m.env_DRIVER_HUB_WEB_DIR,
	DRIVER_HUB_SITE_KEY_FILE: m.env_DRIVER_HUB_SITE_KEY_FILE,
	DRIVER_HUB_BOOTSTRAP_USERNAME: m.env_DRIVER_HUB_BOOTSTRAP_USERNAME,
	DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE: m.env_DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE,
	DRIVER_HUB_ALLOW_PLAIN_HTTP: m.env_DRIVER_HUB_ALLOW_PLAIN_HTTP,
	DRIVER_HUB_ADMIN_TOKEN: m.env_DRIVER_HUB_ADMIN_TOKEN
};

/** What a startup setting is for, in words; a setting this build does not know is still listed. */
export function environmentLabel(name: string): string {
	return (Object.hasOwn(labels, name) ? labels[name] : m.env_unknown)();
}

const sources: Record<EnvironmentSetting['source'], () => string> = {
	environment: m.manager_source_environment,
	default: m.manager_source_default,
	unset: m.manager_source_unset
};

export function environmentSource(setting: EnvironmentSetting): string {
	return sources[setting.source]();
}

/** The value to show. A secret only says whether it is set. */
export function environmentValue(setting: EnvironmentSetting): string | null {
	if (setting.secret) {
		return setting.source === 'environment' ? m.manager_secret_set() : m.manager_secret_unset();
	}
	return setting.value;
}
