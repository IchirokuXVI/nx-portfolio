import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';
import { defineConfig } from 'cypress';

// Odontogram is a remote: served on its own port it bootstraps `RemoteEntry`,
// whose template has no `<router-outlet>`, so the page stays blank and the
// locale guard never settles. It renders only through the shell, which supplies
// the outlet and the singleton-RokuTranslator locale context, so this suite
// drives the shell's `/<locale>/odontogram` route, the same arrangement
// damoclesSword-e2e uses.
const ODONTOGRAM_ROUTE = '/en/odontogram';

// E2E_BASE_URL points the suite at an already-running deployment (e.g. the
// local Docker/Kubernetes reverse proxy at http://portfolio.localhost); the
// shell route suffix is appended to it.
const dockerOrigin = process.env['E2E_BASE_URL'];

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'src',
      webServerCommands: {
        default: 'npx nx run shell:serve',
        production: 'npx nx run shell:serve-static',
      },
      ciWebServerCommand: 'npx nx run shell:serve-static',
      ciBaseUrl: `http://localhost:4200${ODONTOGRAM_ROUTE}`,
    }),
    baseUrl: dockerOrigin
      ? `${dockerOrigin}${ODONTOGRAM_ROUTE}`
      : `http://localhost:4200${ODONTOGRAM_ROUTE}`,
    chromeWebSecurity: false,
    // The remote is lazy-loaded and, in the dev configuration, ships unbundled
    // as hundreds of separate chunk requests, so the first render lands well
    // after `load`. Give the assertions room for that (and more again when
    // running against the slower docker deployment).
    defaultCommandTimeout: dockerOrigin ? 30000 : 15000,
    pageLoadTimeout: dockerOrigin ? 120000 : 60000,
  },
});
