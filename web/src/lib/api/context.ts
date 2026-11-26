import { createContext } from 'svelte';
import type { ApiClient } from './client';

/** The app's single API client, provided by the root layout. */
export const [getApi, setApi] = createContext<ApiClient>();
