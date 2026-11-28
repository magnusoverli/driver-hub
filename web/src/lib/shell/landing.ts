/**
 * The page the app was first opened on. A site that still needs setting up sends an
 * administrator who lands on Devices to Site setup once, without bouncing later visits.
 */
let landing: string | null | undefined;

export function recordLanding(route: string | null): void {
	if (landing === undefined) landing = route;
}

/** True only for the first page shown, and only once. */
export function takeLanding(route: string): boolean {
	if (landing !== route) return false;
	landing = null;
	return true;
}
