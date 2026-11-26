// Shared by the manager launcher and the tests. Test-only values for a throwaway installation.
export const PORT = 4180;
// Browsers accept the manager's Secure session cookie over plain HTTP only on localhost.
export const BASE_URL = `http://localhost:${PORT}`;
export const ADMIN = { username: 'admin', password: 'e2e-admin-password-1' };
export const SERVICE_TOKEN = 'e2e-service-token-not-secret';
