import { TestBed } from '@angular/core/testing';
import {
  CONTENT_LOCALES,
  fieldOf,
  hasDetailScreen,
  idOf,
  toRowView,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { ADMINS, toAdminPage } from './admins';
import { BASKETS } from './baskets';
import { LISTS } from './lists';
import {
  ADMIN_SEED,
  BASKET_SEED,
  LIST_SEED,
  USER_SEED,
  ZONE_SEED,
} from './people-seed';
import { USERS } from './users';
import { ZONES } from './zones';

/**
 * The five descriptors of plan 0007, asserted rather than claimed.
 *
 * Nothing here renders anything. Every rule this plan states about what these
 * screens show, and about what they refuse to show, is a property of a
 * descriptor or of the pure function that formats a row, so this file reads
 * them off directly.
 */

const ALL: readonly AnyResourceDescriptor[] = [
  USERS,
  ZONES,
  LISTS,
  BASKETS,
  ADMINS,
];

const RENDER = { locale: 'en', contentLocales: CONTENT_LOCALES };

/**
 * Whether a property name is one that must never reach this app.
 *
 * `hasPassword` is deliberately not one: it is a boolean saying whether an
 * account can sign in with a password at all, which is a question an operator
 * asks and an answer that reveals nothing. What is banned is the hash.
 */
function isSecret(name: string): boolean {
  return /passwordhash|hash|secret/i.test(name);
}

/**
 * A descriptor's named actions, built the way a screen builds them.
 *
 * `named` is a factory called in an injection context, exactly like `gateway`,
 * because an action calls a service and a descriptor is a constant declared at
 * module scope. The default behind `DIRECTORY_SERVICE` is the in-memory one, so
 * nothing here talks to a gateway.
 */
function namedActionsOf(descriptor: AnyResourceDescriptor) {
  return TestBed.runInInjectionContext(
    () => descriptor.actions?.named?.() ?? []
  );
}

describe('every people descriptor', () => {
  it('names a real field for every column', () => {
    for (const descriptor of ALL) {
      const missing = descriptor.list.columns.filter(
        (name) => fieldOf(descriptor, name) === undefined
      );

      expect([descriptor.name, missing]).toEqual([descriptor.name, []]);
    }
  });

  it('draws its phone columns from its table columns', () => {
    for (const descriptor of ALL) {
      const columns = new Set<string>(descriptor.list.columns);
      const stray = descriptor.list.compact.filter(
        (name) => !columns.has(name)
      );

      expect([descriptor.name, stray]).toEqual([descriptor.name, []]);
    }
  });

  /**
   * Plan 0007, section 1: these rows are not editable in the way catalog rows
   * are, and section 8 puts a row editor over them out of scope now and
   * permanently. So no descriptor here offers create, edit or delete, and
   * everything an operator can do is a named action calling a service.
   */
  it('offers no create, no edit and no delete', () => {
    for (const descriptor of ALL) {
      expect([descriptor.name, descriptor.actions?.create]).toEqual([
        descriptor.name,
        undefined,
      ]);
      expect([descriptor.name, descriptor.actions?.edit]).toEqual([
        descriptor.name,
        undefined,
      ]);
      expect([descriptor.name, descriptor.actions?.delete]).toEqual([
        descriptor.name,
        undefined,
      ]);
    }
  });

  /**
   * Plan 0007, section 3, asserted at the data layer rather than at the screen:
   * `passwordHash` is never selected, so nothing these screens can be handed
   * carries one, and no field could read it even if one did.
   */
  it('never carries a password hash, in a field or in a row', () => {
    for (const descriptor of ALL) {
      const named = descriptor.fields.filter((field) => isSecret(field.name));

      expect([descriptor.name, named]).toEqual([descriptor.name, []]);
    }

    const rows = [
      ...USER_SEED,
      ...ZONE_SEED,
      ...LIST_SEED,
      ...BASKET_SEED,
      ...ADMIN_SEED,
    ];
    for (const row of rows) {
      expect(Object.keys(row).filter(isSecret)).toEqual([]);
    }
  });

  /** Every action is destructive or hard to reverse, so every one is confirmed. */
  it('confirms every named action it offers', () => {
    for (const descriptor of ALL) {
      const unconfirmed = namedActionsOf(descriptor)
        .filter((action) => action.confirm === undefined)
        .map((action) => action.name);

      expect([descriptor.name, unconfirmed]).toEqual([descriptor.name, []]);
    }
  });
});

describe('the users descriptor', () => {
  /**
   * `username` is the global handle and is not unique. Rows are keyed and
   * linked by `userId`, so two identical usernames are an ordinary result
   * rather than a bug (plan 0007, section 2).
   */
  it('keys a row by its user id and not by its username', () => {
    const [rosa, , rosaAgain] = USER_SEED;

    expect(USERS.title(rosa)).toBe(USERS.title(rosaAgain));
    expect(idOf(USERS, rosa)).not.toBe(idOf(USERS, rosaAgain));
  });

  it('renders two accounts with the same username as two rows', () => {
    const [rosa, , rosaAgain] = USER_SEED;

    const views = [rosa, rosaAgain].map((row) => toRowView(USERS, row, RENDER));

    expect(new Set(views.map((view) => view.id)).size).toBe(2);
    expect(views.map((view) => view.title)).toEqual(['rosa', 'rosa']);
  });

  /**
   * `displayName` is whatever an identity provider supplied, which for a Google
   * sign in is somebody's real full name. It belongs on the detail screen and
   * not in a list anybody might screenshot, and it is not a field at all so it
   * cannot be added to `columns` by accident.
   */
  it('keeps the display name out of the listing entirely', () => {
    expect(USERS.list.columns).not.toContain('displayName');
    expect(fieldOf(USERS, 'displayName')).toBeUndefined();
  });

  it('offers every filter the route accepts, and no other', () => {
    expect(USERS.filters?.map((filter) => filter.param)).toEqual([
      'username',
      'email',
      'kind',
      'verified',
      'createdAfter',
      'createdBefore',
    ]);
  });

  /**
   * The gateway refuses an account with no address and one that is already
   * confirmed. A button that is always there and sometimes refuses teaches an
   * operator to ignore the refusal.
   */
  it('offers a resend only where one can work', () => {
    const resend = namedActionsOf(USERS).find(
      (action) => action.name === 'resend-verification'
    );
    const [confirmed, unconfirmed, , temporary] = USER_SEED;

    expect(resend?.available?.(unconfirmed)).toBe(true);
    expect(resend?.available?.(confirmed)).toBe(false);
    expect(resend?.available?.(temporary)).toBe(false);
  });
});

describe('the zones descriptor', () => {
  /** One filter, by one user, which is the whole requirement (plan 0007, section 2). */
  it('filters by a single user, chosen by name', () => {
    const byUser = ZONES.filters?.find((filter) => filter.param === 'userId');

    expect(byUser?.kind).toBe('reference');
    expect(byUser?.kind === 'reference' ? byUser.resource : null).toBe('users');
  });

  /**
   * Plan 0074, section 3: where an id does not resolve, because a user was
   * reaped or a race was lost, the screen renders the id. A listing never fails
   * because a decoration failed.
   */
  it('renders the owner id where the name did not resolve', () => {
    const [kitchen, allotment] = ZONE_SEED;

    const named = toRowView(ZONES, kitchen, RENDER);
    const unresolved = toRowView(ZONES, allotment, RENDER);

    expect(named.cells['ownerName'].text).toBe('rosa');
    expect(unresolved.cells['ownerName'].text).toBe(allotment.ownerUserId);
    expect(unresolved.cells['ownerName'].key).toBeUndefined();
  });

  it('offers the two zone actions and no membership action', () => {
    expect(namedActionsOf(ZONES).map((action) => action.name)).toEqual([
      'regenerate-join-code',
      'delete-zone',
    ]);
  });
});

describe('the list and shopping list descriptors', () => {
  it('shows no line contents in either listing', () => {
    expect(LISTS.list.columns).not.toContain('lines');
    expect(BASKETS.list.columns).not.toContain('lines');
    expect(LISTS.list.columns).toContain('lineCount');
    expect(BASKETS.list.columns).toContain('lineCount');
  });

  it('filters lists by zone and by owner', () => {
    expect(LISTS.filters?.map((filter) => filter.param)).toEqual([
      'zoneId',
      'createdByUserId',
    ]);
  });

  it('filters shopping lists by owner and by zone', () => {
    expect(BASKETS.filters?.map((filter) => filter.param)).toEqual([
      'ownerUserId',
      'zoneId',
    ]);
  });

  /** A basket needs no name, and an unnamed one is the ordinary case. */
  it('calls an unnamed shopping list by its id', () => {
    const [named, unnamed] = BASKET_SEED;

    expect(BASKETS.title(named)).toBe('Saturday');
    expect(BASKETS.title(unnamed)).toBe(unnamed.id);
  });
});

describe('the admins descriptor', () => {
  /**
   * Plan 0071, section 6 and plan 0007, section 2: an admin can be seen and
   * cannot be created, edited or deleted from here, ever. There is no detail
   * screen either, so `resourceRoutes` declares one route and the list draws
   * its rows as text.
   */
  it('can be read and can never be written', () => {
    expect(ADMINS.actions).toBeUndefined();
    expect(ADMINS.detail).toBeUndefined();
    expect(hasDetailScreen(ADMINS)).toBe(false);
  });

  it('says in place how an admin is actually managed', () => {
    expect(ADMINS.note).toBe('people.admins.note');
  });

  /** The one collection under `/v1/admin/**` that answers `{ admins }`. */
  it('reads a page out of the shape that route really answers with', () => {
    const page = toAdminPage({ admins: ADMIN_SEED });

    expect(page.items).toHaveLength(ADMIN_SEED.length);
    expect(page.nextCursor).toBeNull();
  });

  it('answers an empty page for a body it cannot read', () => {
    expect(toAdminPage(null)).toEqual({ items: [], nextCursor: null });
    expect(toAdminPage({ items: ADMIN_SEED })).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});
