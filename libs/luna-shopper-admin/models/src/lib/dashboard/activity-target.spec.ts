import type { PathOf } from '../resource/resource-path';
import { activityTarget } from './activity-target';

/**
 * A resolver that mounts the five screens the way admin plan 0022 does, so the
 * assertions read as the URLs an operator would land on.
 */
const mounted: PathOf = (name) => {
  const section: Record<string, string | undefined> = {
    items: 'catalog',
    prices: 'catalog',
    users: 'shoppers',
    zones: 'shoppers',
    lists: 'shoppers',
  };
  const segment = section[name];

  return segment === undefined ? null : ['/', segment, name];
};

/** An app that mounted nothing, which is what a resolver answers `null` for. */
const nothing: PathOf = () => null;

describe('activityTarget', () => {
  it.each([
    ['zones', ['/', 'shoppers', 'zones']],
    ['shopping_lists', ['/', 'shoppers', 'lists']],
    ['users', ['/', 'shoppers', 'users']],
    ['items', ['/', 'catalog', 'items']],
    ['item_prices', ['/', 'catalog', 'prices']],
  ])(
    'sends a %s row to its own screen, wherever it is mounted',
    (entity, path) => {
      expect(activityTarget({ entity, entityId: 'row-1' }, mounted)).toEqual([
        ...path,
        'row-1',
      ]);
    }
  );

  /**
   * Every one of these is addressed by a composite key in this app, because no
   * route reads one of the rows by its own uuid, and the audit row carries the
   * uuid. A link built from it would land on the not found page, which costs a
   * navigation to learn that the answer was no.
   */
  it.each(['supermarket_items', 'list_lines', 'zone_memberships'])(
    'has no target for a %s row',
    (entity) => {
      expect(activityTarget({ entity, entityId: 'row-1' }, mounted)).toBeNull();
    }
  );

  it('has no target for a table this app has no screen for', () => {
    expect(
      activityTarget(
        { entity: 'admin_login_failures', entityId: 'row-1' },
        mounted
      )
    ).toBeNull();
  });

  it('has no target for a row with no id', () => {
    expect(
      activityTarget({ entity: 'zones', entityId: '' }, mounted)
    ).toBeNull();
  });

  /**
   * The table is known and the screen is not mounted, which is the same answer
   * as an unknown table for the same reason: there is no URL to send anybody to.
   */
  it('has no target where the resolver does not know the resource', () => {
    expect(
      activityTarget({ entity: 'zones', entityId: 'row-1' }, nothing)
    ).toBeNull();
  });
});
