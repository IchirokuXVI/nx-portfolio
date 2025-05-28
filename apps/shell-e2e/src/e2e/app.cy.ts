describe('shell-e2e', () => {
  beforeEach(() => cy.visit('/non-existing-path'));

  it('should display 404 page', () => {
    cy.get('h1').contains('404');
    cy.get('h1').contains('Page Not Found');
  });
});
