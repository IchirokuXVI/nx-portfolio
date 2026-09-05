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
   * which is opened to answer one question and never to change anything.
   *
   * Inside the catalog the order follows what an operator is holding in their
   * head rather than the alphabet. A chain, then the shops and scopes that
   * belong to one, then the products and the groups that make two products
   * comparable, then the prices, which need a product and a scope to exist at
   * all. The per shop rows are last, being the narrowest question here.
   *
   * Among the people, each nested collection follows the resource it hangs off:
   * a membership after zones, a line after lists.
   */
  it('lists the screens in the order the navigation shows them', () => {
    expect(ADMIN_RESOURCES.map((resource) => resource.name)).toEqual([
      'supermarkets',
      'locations',
      'price-scopes',
      'items',
      'product-groups',
      'prices',
      'price-policies',
      'location-items',
      'users',
      'zones',
      'memberships',
      'lists',
      'list-lines',
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
   * drawn as the uuid it is and never opens a picker, which is why
   * `defaultPriceScopeId` could point at `price-scopes` before `0005` added
   * that screen.
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
