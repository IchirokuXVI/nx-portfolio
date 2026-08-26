import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'src',
      webServerCommands: {
        default: 'npx nx run landing:serve',
        production: 'npx nx run landing:serve-static',
      },
      ciWebServerCommand: 'npx nx run landing:serve-static',
      ciBaseUrl: 'http://localhost:4200',
    }),
    // E2E_BASE_URL points the suite at an already-running deployment (e.g. the
    // local Docker/Kubernetes reverse proxy at http://portfolio.localhost).
    baseUrl: process.env['E2E_BASE_URL'] || 'http://localhost:4201',
    chromeWebSecurity: false,
  },
});
