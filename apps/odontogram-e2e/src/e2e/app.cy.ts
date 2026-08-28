import { getOdontogram } from '../support/app.po';

/**
 * Smoke tests for odontogram mounted through the shell, and for the locale
 * invariant plan 0003 gives it: the segment directly below `/odontogram` is a
 * supported, canonical locale before anything renders.
 *
 * The assertion these replaced was the Nx scaffold's `h1` containing "Welcome",
 * which no odontogram markup has ever rendered. It went unnoticed because the
 * suite could not reach the app at all: `baseUrl` carried a path, which Cypress
 * discards for a `cy.visit('/')`, so every spec ran against the site root.
 */
const MOUNT = '/odontogram';
const LOCALE = /^\/odontogram\/(en|es)(\/|$)/;

describe('odontogram-e2e', () => {
  it('mounts the odontogram feature through the shell', () => {
    cy.visit(`${MOUNT}/en`);

    getOdontogram().should('exist');
    cy.location('pathname').should('eq', `${MOUNT}/en`);
  });

  it('inserts a locale when the URL arrives without one', () => {
    cy.visit(MOUNT);

    cy.location('pathname').should('match', LOCALE);
    getOdontogram().should('exist');
  });

  it('replaces a locale the app does not support', () => {
    cy.visit(`${MOUNT}/zz`);

    cy.location('pathname').should('not.match', /\/zz(\/|$)/);
    cy.location('pathname').should('match', LOCALE);
    getOdontogram().should('exist');
  });

  it('rewrites a supported locale to its canonical form', () => {
    cy.visit(`${MOUNT}/en-US`);

    cy.location('pathname').should('eq', `${MOUNT}/en`);
  });
});
