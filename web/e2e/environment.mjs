// Shared by the manager launcher and the tests. Test-only values for a throwaway installation.
export const PORT = Number(process.env.DRIVER_HUB_E2E_PORT ?? 4180);
// Browsers accept the manager's Secure session cookie over plain HTTP only on localhost.
export const BASE_URL = `http://localhost:${PORT}`;
export const ADMIN = { username: 'admin', password: 'e2e-admin-password-1' };
export const SERVICE_TOKEN = 'e2e-service-token-not-secret';

// A second installation connected to the fake Nomad in e2e/cluster, with seeded deployments.
export const CLUSTER_PORT = PORT + 2;
export const CLUSTER_BASE_URL = `http://localhost:${CLUSTER_PORT}`;
export const FAKE_NOMAD_PORT = PORT + 3;
export const FAKE_NOMAD_URL = `http://127.0.0.1:${FAKE_NOMAD_PORT}`;
