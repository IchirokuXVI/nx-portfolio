import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'src',
      webServerCommands: {
        default: 'npx nx run shell:serve --host 0.0.0.0',
        production: 'npx nx run shell:serve-static --host 0.0.0.0',
      },
      ciWebServerCommand: 'npx nx run shell:serve-static',
      ciBaseUrl: 'http://localhost:4200',
    }),
    // E2E_BASE_URL points the suite at an already-running deployment (e.g. the
    // local Docker/Kubernetes reverse proxy at http://portfolio.localhost). Run
    // it with `npx cypress run` directly so no dev server is started.
    baseUrl: process.env['E2E_BASE_URL'] || 'http://localhost:4200',
    chromeWebSecurity: false,
    // Dev-configuration remotes ship unbundled: a heavy remote (e.g. odontogram)
    // lazily loads hundreds of separate chunk requests, and Angular only finalizes
    // the locale redirect once that load resolves. Give those assertions more room
    // when running against the (slower) docker deployment.
    defaultCommandTimeout: process.env['E2E_BASE_URL'] ? 30000 : 4000,
    pageLoadTimeout: process.env['E2E_BASE_URL'] ? 120000 : 60000,
  },
});
