import { AppApiConfig } from '@portfolio/velista/models';

/**
 * The app's own environment surface (plan 0001, the extraction contract, item 6).
 *
 * Deliberately NOT `@portfolio/shared/environments`: that object describes the
 * portfolio's own backend, and this app must not inherit assumptions baked into
 * shared portfolio code. When the app is extracted, this file moves with it and
 * nothing else changes.
 *
 * Swapped at build time by `fileReplacements` (see project.json), the standard
 * Angular mechanism the rest of the workspace already uses.
 */
export const environment: { production: boolean; api: AppApiConfig } = {
  production: false,
  api: {
    // The luna-shopper gateway (PORT defaults to 3000 in its config schema).
    gatewayBaseUrl: 'http://localhost:3000',
    // The realtime service (PORT defaults to 3001). The transport — WebSocket
    // with an SSE fallback — is the realtime client's choice, not this URL's.
    realtimeBaseUrl: 'http://localhost:3001',
  },
};
