import { activityTarget } from './activity-target';

describe('activityTarget', () => {
  it.each([
    ['zones', '/zones'],
    ['shopping_lists', '/lists'],
    ['users', '/users'],
    ['items', '/items'],
    ['item_prices', '/prices'],
  ])('sends a %s row to its own screen', (entity, segment) => {
    expect(activityTarget({ entity, entityId: 'row-1' })).toEqual([
      '/',
      segment.slice(1),
      'row-1',
    ]);
  });

  /**
   * Every one of these is addressed by a composite key in this app, because no
   * route reads one of the rows by its own uuid, and the audit row carries the
   * uuid. A link built from it would land on the not found page, which costs a
   * navigation to learn that the answer was no.
   */
  it.each(['supermarket_items', 'list_lines', 'zone_memberships'])(
    'has no target for a %s row',
    (entity) => {
      expect(activityTarget({ entity, entityId: 'row-1' })).toBeNull();
    }
  );

  it('has no target for a table this app has no screen for', () => {
    expect(
      activityTarget({ entity: 'admin_login_failures', entityId: 'row-1' })
    ).toBeNull();
  });

  it('has no target for a row with no id', () => {
    expect(activityTarget({ entity: 'zones', entityId: '' })).toBeNull();
  });
});
