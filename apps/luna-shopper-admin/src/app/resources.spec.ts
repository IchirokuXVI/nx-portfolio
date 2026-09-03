import { ADMIN_RESOURCES } from './resources';

/**
 * The app's own list of screens.
 *
 * It is what the route table is built from and what the navigation is read
 * from, so a resource cannot end up reachable without a link or linked without a
 * route. Two properties of the list itself are worth asserting, because neither
 * fails loudly: a repeated segment would shadow a screen, and a repeated name
 * would send every reference picker pointing at it to whichever descriptor came
 * first.
 */
describe('ADMIN_RESOURCES', () => {
  it('gives every resource its own route segment', () => {
    const segments = ADMIN_RESOURCES.map((resource) => resource.segment);

    expect(new Set(segments).size).toBe(segments.length);
  });

  it('gives every resource its own name, which is what a reference points at', () => {
    const names = ADMIN_RESOURCES.map((resource) => resource.name);

    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * Grouped by what an operator came here to do: the catalog, which is the half
   * that gets edited; then the people and what they share; then the admin table,
   * which is opened to answer one question and never to change anything. Inside
   * the catalog, chains come before everything addressed under one and the two
   * screens that join its halves come last.
   */
  it('lists the screens in the order the navigation shows them', () => {
    expect(ADMIN_RESOURCES.map((resource) => resource.name)).toEqual([
      'supermarkets',
      'locations',
      'price-scopes',
      'product-groups',
      'items',
      'prices',
      'location-items',
      'users',
      'zones',
      'lists',
      'baskets',
      'admins',
    ]);
  });

  /**
   * Every reference that draws a **picker** names a resource this app mounted.
   * One that did not would be a control that finds nothing, with nothing to say
   * about why.
   *
   * A reference the form cannot change is deliberately not in this check. It is
   * drawn as the uuid it is and never opens a picker, so it may point at a
   * resource this app has not mounted.
   */
  it('points every reference picker at a resource that exists', () => {
    const names = new Set(ADMIN_RESOURCES.map((resource) => resource.name));
    const targets = ADMIN_RESOURCES.flatMap((resource) => [
      ...resource.fields
        .filter(
          (field) => field.kind === 'reference' && field.editable !== false
        )
        .map((field) => (field.kind === 'reference' ? field.resource : '')),
      ...(resource.filters ?? [])
        .filter((filter) => filter.kind === 'reference')
        .map((filter) => (filter.kind === 'reference' ? filter.resource : '')),
    ]);

    expect(targets.filter((target) => !names.has(target))).toEqual([]);
  });
});
