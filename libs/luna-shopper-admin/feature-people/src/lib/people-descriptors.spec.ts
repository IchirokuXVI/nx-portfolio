import { TestBed } from '@angular/core/testing';
import { ResourceListStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeId,
  CONTENT_LOCALES,
  draftFor,
  fieldOf,
  hasDetailScreen,
  idOf,
  toInput,
  toRowView,
  type AnyResourceDescriptor,
} from '@portfolio/luna-shopper-admin/models';
import { ADMINS, toAdminPage } from './admins';
import { BASKETS } from './baskets';
import { LIST_LINES } from './list-lines';
import { LISTS } from './lists';
import { MEMBERSHIPS } from './memberships';
import {
  ADMIN_SEED,
  BASKET_SEED,
  LIST_LINE_SEED,
  LIST_SEED,
  MEMBERSHIP_SEED,
  USER_SEED,
  ZONE_SEED,
} from './people-seed';
import { USERS } from './users';
import { ZONES } from './zones';

/**
 * The people descriptors, asserted rather than claimed.
 *
 * Nothing here renders anything. Every rule plans 0007 and 0009 state about what
 * these screens show, about what they let an operator change, and about what
 * they refuse to show, is a property of a descriptor or of the pure function
 * that formats a row, so this file reads them off directly.
 */

const ALL: readonly AnyResourceDescriptor[] = [
  USERS,
  ZONES,
  MEMBERSHIPS,
  LISTS,
  LIST_LINES,
  BASKETS,
  ADMINS,
];

/** The five plan 0009 made editable, and the two it deliberately did not. */
const EDITABLE: readonly AnyResourceDescriptor[] = [
  USERS,
  ZONES,
  MEMBERSHIPS,
  LISTS,
  LIST_LINES,
];

const READ_ONLY: readonly AnyResourceDescriptor[] = [BASKETS, ADMINS];

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
   * Plan 0009, section 8: five of these resources render an edit control and
   * two render none.
   *
   * `0007` made all of them read only, on the grounds that the invariants live
   * in services rather than in constraints. That is still the rule; what
   * changed is that backend plan 0077 put a service behind each of these
   * writes, so an operator's edit is the write a member of the zone would make.
   */
  it('offers an edit exactly where a service stands behind one', () => {
    for (const descriptor of EDITABLE) {
      expect([descriptor.name, descriptor.actions?.edit]).toEqual([
        descriptor.name,
        true,
      ]);
    }

    for (const descriptor of READ_ONLY) {
      expect([descriptor.name, descriptor.actions?.edit]).toEqual([
        descriptor.name,
        undefined,
      ]);
    }
  });

  /**
   * Nothing here is created from the back office, and that is a decision per
   * resource rather than an omission. An operator does not make accounts or
   * households, joining a zone is done with a join code by the person joining,
   * a basket is generated, an admin needs the server, and a line records who
   * wrote it in a column that cannot be empty.
   */
  it('creates nothing at all', () => {
    for (const descriptor of ALL) {
      expect([descriptor.name, descriptor.actions?.create]).toEqual([
        descriptor.name,
        undefined,
      ]);
    }
  });

  /**
   * Deleting is narrower still. A list and one of its lines can go; everything
   * else either has a named action whose confirmation says what goes with it,
   * or has no way out at all.
   */
  it('deletes only a list and a line', () => {
    const deletable = ALL.filter(
      (descriptor) => descriptor.actions?.delete === true
    ).map((descriptor) => descriptor.name);

    expect(deletable).toEqual(['lists', 'list-lines']);
  });

  /**
   * Plan 0009, section 5, asserted over the descriptors rather than screen by
   * screen, so a field added later without a reason fails here.
   *
   * "Read only" says nothing. The sentence has to name what does change the
   * value, or why nothing does, because an operator looking for a missing
   * control should find an answer rather than conclude the screen is unfinished.
   */
  it('explains every field it will not let an operator change', () => {
    for (const descriptor of EDITABLE) {
      const unexplained = descriptor.fields
        .filter((field) => field.editable === false && field.help === undefined)
        .map((field) => field.name);

      expect([descriptor.name, unexplained]).toEqual([descriptor.name, []]);
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

  /**
   * Every action is destructive or hard to reverse, so every one is confirmed,
   * with **one** exception: restoring a zone is the undo of marking it, and
   * asking before somebody takes back a mistake is a click that teaches an
   * operator to click through the next one (plan 0009, section 3.1).
   */
  it('confirms every named action but the one that is an undo', () => {
    for (const descriptor of ALL) {
      const unconfirmed = namedActionsOf(descriptor)
        .filter((action) => action.confirm === undefined)
        .map((action) => action.name);

      const allowed = descriptor.name === 'zones' ? ['restore-zone'] : [];
      expect([descriptor.name, unconfirmed]).toEqual([
        descriptor.name,
        allowed,
      ]);
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
   * sign in is somebody's real full name. It belongs on the detail screen, which
   * is the form, and not in a list anybody might screenshot. Plan 0009 made it
   * editable, so it is a field now; what has not changed is that it is not a
   * column.
   */
  it('keeps the display name off the listing while letting the form change it', () => {
    expect(USERS.list.columns).not.toContain('displayName');
    expect(USERS.list.compact).not.toContain('displayName');
    expect(fieldOf(USERS, 'displayName')?.editable).toBeUndefined();
  });

  /**
   * Plan 0009, section 2: two fields change and the other four do not. The
   * three that plan 0077, section 6 refuses outright are the ones worth naming,
   * because each is a column somebody would otherwise reach for.
   */
  it('changes the two columns a service stands behind, and no others', () => {
    const editable = USERS.fields
      .filter((field) => field.editable !== false)
      .map((field) => field.name);

    expect(editable).toEqual(['username', 'displayName']);
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

  it('offers the four zone actions and no membership action', () => {
    expect(namedActionsOf(ZONES).map((action) => action.name)).toEqual([
      'regenerate-join-code',
      'mark-for-deletion',
      'restore-zone',
      'delete-zone',
    ]);
  });

  /**
   * Plan 0009, section 3.1: `name` and `config` are the whole of what a zone's
   * own owner may change, and an operator gets exactly the same two.
   */
  it('changes a zone name and its settings, and nothing else', () => {
    const editable = ZONES.fields
      .filter((field) => field.editable !== false)
      .map((field) => field.name);

    expect(editable).toEqual(['name', 'config']);
  });

  /**
   * The two deletion columns are a pair. Marking is confirmed and names the
   * zone; restoring is not, because it is the undo. Each is offered only where
   * it means something, so no row shows both.
   */
  it('offers marking or restoring, never both on one zone', () => {
    const [active, marked] = ZONE_SEED;
    const [, mark, restore] = namedActionsOf(ZONES);

    expect(mark.available?.(active)).toBe(true);
    expect(mark.available?.(marked)).toBe(false);
    expect(restore.available?.(active)).toBe(false);
    expect(restore.available?.(marked)).toBe(true);
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

/**
 * The two nested collections plan 0009 adds.
 *
 * Both hang off a parent, both are addressed by the pair, and both have exactly
 * one field an operator would reach for that turns out to be an act instead.
 */
describe('the membership descriptor', () => {
  it('cannot be read until a zone is named, and says which filter is missing', () => {
    expect(MEMBERSHIPS.requires).toEqual(['zoneId']);
    expect(MEMBERSHIPS.filters?.map((filter) => filter.param)).toEqual([
      'zoneId',
    ]);
  });

  /**
   * `setRole` refuses `OWNER`, because ownership is a transfer and the transfer
   * is two role changes and a column in one transaction. A picker that offered
   * it would be a control whose only outcome is a refusal.
   */
  it('does not offer OWNER in the role picker', () => {
    const role = fieldOf(MEMBERSHIPS, 'role');
    const values =
      role?.kind === 'enum' ? role.options.map((o) => o.value) : [];

    expect(values).toEqual(['ADMIN', 'MEMBER']);
    expect(values).not.toContain('OWNER');
  });

  /**
   * Plan 0077, section 4.4: the status moves along a state machine with a
   * service method per edge, and each edge does more than write the enum. So it
   * is locked, and the four verbs are four actions.
   */
  it('locks the status and offers the four verbs that move it', () => {
    expect(fieldOf(MEMBERSHIPS, 'status')?.editable).toBe(false);
    expect(fieldOf(MEMBERSHIPS, 'status')?.help).toBeDefined();
    expect(namedActionsOf(MEMBERSHIPS).map((action) => action.name)).toEqual([
      'approve-member',
      'reject-member',
      'kick-member',
      'ban-member',
    ]);
  });

  /**
   * Core refuses a kick and a ban against an owner, so neither is offered
   * against one, and only a waiting member can be let in or refused.
   */
  it('offers each verb only where core would accept it', () => {
    const [approve, reject, kick, ban] = namedActionsOf(MEMBERSHIPS);
    const [owner] = MEMBERSHIP_SEED.filter((row) => row.role === 'OWNER');
    const [waiting] = MEMBERSHIP_SEED.filter((row) => row.status === 'PENDING');

    // The fixture is what makes this test mean anything, so it is asserted.
    expect([owner, waiting]).not.toContain(undefined);

    expect(kick.available?.(owner)).toBe(false);
    expect(ban.available?.(owner)).toBe(false);
    expect(approve.available?.(waiting)).toBe(true);
    expect(reject.available?.(waiting)).toBe(true);
    expect(approve.available?.(owner)).toBe(false);
  });

  /**
   * A membership carries no zone of its own, because the URL that answered it
   * already named one. The pair is its address, and the seed carries the value
   * the gateway puts back on a row.
   */
  it('addresses a row by the pair of zone and membership', () => {
    const [first] = MEMBERSHIP_SEED;

    expect(idOf(MEMBERSHIPS, first)).toBe(
      compositeId([first.zoneId, first.membershipId])
    );
  });

  it('warns that a change is seen by the whole zone', () => {
    expect(MEMBERSHIPS.formNote).toBe('people.broadcast');
  });
});

describe('the list line descriptor', () => {
  it('cannot be read until a list is named, and says which filter is missing', () => {
    expect(LIST_LINES.requires).toEqual(['listId']);
    expect(LIST_LINES.filters?.map((filter) => filter.param)).toEqual([
      'listId',
    ]);
  });

  /**
   * `createdByUserId` is not nullable and an operator is not a user, so there
   * is no route that creates one. The list says so where the control would be,
   * rather than offering a button the gateway refuses.
   */
  it('offers no way to add a line, and says why in place', () => {
    expect(LIST_LINES.actions?.create).toBeUndefined();
    expect(LIST_LINES.note).toBe('people.lines.note');
  });

  it('locks the approval and offers the two acts that move it', () => {
    expect(fieldOf(LIST_LINES, 'approvalStatus')?.editable).toBe(false);
    expect(fieldOf(LIST_LINES, 'approvalStatus')?.help).toBeDefined();
    expect(namedActionsOf(LIST_LINES).map((action) => action.name)).toEqual([
      'approve-line',
      'reject-line',
    ]);
  });

  it('changes what a line says and how many, and nothing else', () => {
    const editable = LIST_LINES.fields
      .filter((field) => field.editable !== false)
      .map((field) => field.name);

    expect(editable).toEqual(['content', 'quantity']);
  });

  it('addresses a row by the pair of list and line', () => {
    const [first] = LIST_LINE_SEED;

    expect(idOf(LIST_LINES, first)).toBe(compositeId([first.listId, first.id]));
  });

  it('warns that a change is seen by the whole zone', () => {
    expect(LIST_LINES.formNote).toBe('people.broadcast');
  });
});

describe('what plan 0009 deliberately left read only', () => {
  /**
   * A basket is output. Its lines carry origins that say where they came from
   * and settlements written against them, so a changed content or quantity
   * contradicts rows already on disk, inside one person's private document.
   */
  it('says on the basket screen why there is nothing to press', () => {
    expect(BASKETS.actions).toBeUndefined();
    expect(BASKETS.note).toBe('people.baskets.note');
  });

  /**
   * Plan 0071, section 6, permanently: a back office that can create back
   * office accounts is one where a single compromised session is forever.
   */
  it('leaves the admin table exactly as plan 0007 left it', () => {
    expect(ADMINS.actions).toBeUndefined();
    expect(ADMINS.note).toBe('people.admins.note');
  });
});

/**
 * Plan 0009, section 7. Every write to a zone, a membership, a list or a line
 * emits the realtime event a member's own edit emits, so a change lands under
 * somebody's thumb while they are shopping. The form says so before it happens,
 * rather than asking on every edit, which becomes a click people stop reading.
 *
 * A user is not on this list, and that is right: renaming somebody does reach
 * their memberships, and the username field says that where it is relevant.
 */
describe('an edit that is seen by whoever is holding the app', () => {
  it('warns on exactly the four resources that broadcast', () => {
    const warned = ALL.filter(
      (descriptor) => descriptor.formNote === 'people.broadcast'
    ).map((descriptor) => descriptor.name);

    expect(warned).toEqual(['zones', 'memberships', 'lists', 'list-lines']);
  });
});

/**
 * The three columns backend plan 0077, section 6 refuses outright, asserted on
 * the body rather than on the screen.
 *
 * Marking a field not editable keeps it out of the draft, so it can never reach
 * `toInput` however the form is driven. This is the assertion that would fail if
 * somebody made one of them editable to "fix" a screen that looks incomplete.
 */
describe('what a user form actually submits', () => {
  it('sends the two fields a service stands behind, and nothing else', () => {
    const [rosa] = USER_SEED;
    const original = draftFor(USERS, rosa, 'edit');
    const draft = { ...original, username: 'rosa2', displayName: 'Rosa I.' };

    expect(toInput(USERS, draft, 'edit', original)).toEqual({
      username: 'rosa2',
      displayName: 'Rosa I.',
    });
  });

  it('carries no email, no confirmation date and no kind, whatever is in the draft', () => {
    const [rosa] = USER_SEED;
    const original = draftFor(USERS, rosa, 'edit');
    // A draft that somehow held them anyway, which is what a regression would
    // look like. They are not editable, so `toInput` does not read them.
    const draft = {
      ...original,
      username: 'rosa2',
      email: 'somebody-else@example.com',
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      kind: 'REGISTERED',
    };
    const body = toInput(USERS, draft, 'edit', original);

    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('emailVerifiedAt');
    expect(body).not.toHaveProperty('kind');
  });
});

/**
 * Plan 0009, sections 3.2 and 4.2: a nested list with no parent chosen is a
 * **third** state, beside empty and no match.
 *
 * Asking the gateway anyway would answer 400, and drawing "there is nothing
 * here" would be a claim nobody checked. The store answers neither: it asks for
 * nothing and names the filter that is missing, which is what the screen puts on
 * the page.
 */
describe('a nested list with no parent chosen', () => {
  const storeFor = (descriptor: AnyResourceDescriptor) =>
    TestBed.runInInjectionContext(
      () => new ResourceListStore(descriptor, descriptor.gateway())
    );

  it('blocks the membership list until a zone is named', async () => {
    const store = storeFor(MEMBERSHIPS);
    await store.load();

    expect(store.blocked()).toBe(true);
    expect(store.missingFilters()).toEqual(['zoneId']);
    expect(store.rows()).toEqual([]);
    expect(store.empty()).toBe(false);

    await store.setFilter('zoneId', ZONE_SEED[0].id);

    expect(store.blocked()).toBe(false);
    expect(store.rows().length).toBeGreaterThan(0);
  });

  it('blocks the line list until a list is named', async () => {
    const store = storeFor(LIST_LINES);
    await store.load();

    expect(store.blocked()).toBe(true);
    expect(store.missingFilters()).toEqual(['listId']);
    expect(store.rows()).toEqual([]);

    await store.setFilter('listId', LIST_SEED[0].id);

    expect(store.blocked()).toBe(false);
    expect(store.rows().length).toBeGreaterThan(0);
  });
});
