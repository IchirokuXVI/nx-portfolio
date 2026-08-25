import { AppApiConfig } from '@portfolio/velista/models';

/**
 * Production counterpart of environment.ts, swapped in by `fileReplacements`.
 * See that file for why this app carries its own environment surface rather
 * than reading `@portfolio/shared/environments`.
 *
 * The gateway host matches the backend's own config (`googleCallbackUrl` in
 * k8s/helm/values.yaml points at the same origin).
 */
export const environment: { production: boolean; api: AppApiConfig } = {
  production: true,
  api: {
    gatewayBaseUrl: 'https://api.ichirokuxvi.com',
    realtimeBaseUrl: 'https://api.ichirokuxvi.com',
  },
};
