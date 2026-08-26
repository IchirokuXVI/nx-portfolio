import { getOdontogram } from '../support/app.po';

/**
 * Smoke test that the odontogram remote mounts through the shell.
 *
 * The assertion this replaced was the Nx scaffold's `h1` containing "Welcome",
 * which no odontogram markup has ever rendered. It went unnoticed because the
 * suite failed to compile before any spec ran. Assert on the feature component
 * the remote's route actually renders instead.
 */
describe('odontogram-e2e', () => {
  beforeEach(() => cy.visit('/'));

  it('mounts the odontogram feature through the shell', () => {
    getOdontogram().should('exist');
  });

  it('keeps the locale segment on the odontogram route', () => {
    cy.location('pathname').should(
      'match',
      /^\/[a-z]{2}(-[a-z]{2})?\/odontogram/i
    );
  });
});
