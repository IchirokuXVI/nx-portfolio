import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'src',
      webServerCommands: {
        default: 'npx nx run odontogram:serve --host 0.0.0.0',
        production: 'npx nx run odontogram:serve-static --host 0.0.0.0',
      },
      ciWebServerCommand: 'npx nx run odontogram:serve-static',
      ciBaseUrl: 'http://localhost:4200',
    }),
    baseUrl: 'http://localhost:4201',
  },
});
