import { TestBed } from '@angular/core/testing';
import {
  RESOURCE_GATEWAYS,
  ResourceListStore,
  type ResourceSource,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeId,
  CONTENT_LOCALES,
  draftFor,
  fieldOf,
  idOf,
  toInput,
  toRowView,
  type AnyResourceDescriptor,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { BASKETS, ZONE_BASKETS } from './baskets';
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
import { ZONE_CAUTION } from './shopper-params';
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
];

/** The five plan 0009 made editable, and the two it deliberately did not. */
const EDITABLE: readonly AnyResourceDescriptor[] = [
  USERS,
  ZONES,
  MEMBERSHIPS,
  LISTS,
  LIST_LINES,
];

const READ_ONLY: readonly AnyResourceDescriptor[] = [BASKETS];

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

/**
 * What a descriptor asks the gateway factory for.
 *
 * The source is the half of a descriptor no screen reads, and it is where plan
 * 0017 does its work: a path with no hole in it, no `pathParams`, and a member
 * path still built from the pair. So it is captured rather than inferred, by
 * standing in for `RESOURCE_GATEWAYS` and keeping what it was handed.
 */
function sourceOf(
  descriptor: AnyResourceDescriptor
): ResourceSource<ResourceRow> {
  let captured: ResourceSource<ResourceRow> | undefined;

  TestBed.configureTestingModule({
    providers: [
      {
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: (source: ResourceSource<ResourceRow>) => {
            captured = source;
            return {} as ResourceGateway<ResourceRow>;
          },
        },
      },
    ],
  });
  TestBed.runInInjectionContext(() => descriptor.gateway());
  TestBed.resetTestingModule();

  if (captured === undefined) {
    throw new Error('the descriptor asked for no gateway');
  }
  return captured;
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

    expect(USERS.title(rosa, CONTENT_LOCALES)).toBe(
      USERS.title(rosaAgain, CONTENT_LOCALES)
    );
    expect(idOf(USERS, rosa)).not.toBe(idOf(USERS, rosaAgain));
  });

  /**
   * Eleven of the sixteen descriptors return a plain field and ignore the
   * reading order (admin plan 0026, section 5). A username is not localized
   * text and never becomes any, so the widened signature has to cost these
   * nothing: the same name under either choice.
   */
  it('calls an account by its username whatever language the operator reads', () => {
    const [rosa] = USER_SEED;

    expect(USERS.title(rosa, ['en', 'es'])).toBe('rosa');
    expect(USERS.title(rosa, ['es', 'en'])).toBe('rosa');
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
      'role',
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
   * Plan 0012, section 3: the owner alone is askable, and its "none" is the
   * zones an owner's deletion left behind. The person filter offers no "none",
   * because a zone nobody is in at all is not a question with a route.
   */
  it('offers none on the owner filter and on no other', () => {
    const offering = (ZONES.filters ?? [])
      .filter((filter) => filter.kind === 'reference' && filter.nullable)
      .map((filter) => filter.param);

    expect(offering).toEqual(['ownerUserId']);
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

  /**
   * Admin plan 0045: the lists are a tab of their zone, so the zone comes from
   * the address. Lists by who made them is dropped, by the owner's decision.
   */
  it('reads the zone of a list from the address, and offers no filter', () => {
    expect(LISTS.parent).toEqual({
      resource: 'zones',
      param: 'zoneId',
      filter: 'zoneId',
    });
    expect(LISTS.filters).toBeUndefined();
    expect(LISTS.list.columns).not.toContain('zoneName');
  });

  it('says behind the info button who adds a line and who corrects one', () => {
    expect(LISTS.info?.points).toEqual([
      'people.lists.info.corrects',
      'people.lists.info.adds',
    ]);
  });

  /**
   * One collection, two tabs. A person's tab takes the owner from the address
   * and a zone's tab takes the zone, and each still offers the other filter.
   */
  it('lists shopping lists under a person and under a zone', () => {
    expect(BASKETS.parent).toEqual({
      resource: 'users',
      param: 'userId',
      filter: 'ownerUserId',
    });
    expect(ZONE_BASKETS.parent).toEqual({
      resource: 'zones',
      param: 'zoneId',
      filter: 'zoneId',
    });
    expect(ZONE_BASKETS.segment).toBe(BASKETS.segment);
    expect(ZONE_BASKETS.fields).toEqual(BASKETS.fields);

    for (const descriptor of [BASKETS, ZONE_BASKETS]) {
      expect(descriptor.filters?.map((filter) => filter.param)).toEqual([
        'ownerUserId',
        'zoneId',
      ]);
    }
  });

  /** A basket needs no name, and an unnamed one is the ordinary case. */
  it('calls an unnamed shopping list by its day, never by its ID', () => {
    const [named, unnamed] = BASKET_SEED;

    expect(BASKETS.title(named, CONTENT_LOCALES)).toBe('Saturday');
    expect(BASKETS.title(unnamed, CONTENT_LOCALES)).toBe(
      unnamed.generatedAt.slice(0, 10)
    );
    expect(BASKETS.title(unnamed, CONTENT_LOCALES)).not.toContain(unnamed.id);
  });
});

/**
 * The two collections plan 0009 adds, and plan 0017 opened.
 *
 * Each row is addressed by the pair it is keyed on, each has exactly one field
 * an operator would reach for that turns out to be an act instead, and neither
 * refuses to draw anything until its parent is named.
 */
describe('the membership descriptor', () => {
  /** Admin plan 0045: the members are a tab of their zone. */
  it('reads the zone from the address, and offers no filter', () => {
    expect(MEMBERSHIPS.segment).toBe('members');
    expect(MEMBERSHIPS.parent).toEqual({
      resource: 'zones',
      param: 'zoneId',
      filter: 'zoneId',
    });
    expect(MEMBERSHIPS.filters).toBeUndefined();
  });

  /**
   * Plan 0017, section 4: the collection is a plain path with a plain query
   * parameter, so there is nothing for `pathParams` to keep out of the query
   * string, and nothing for `collectionPath` to refuse to build. One membership
   * is still under its zone, because there is no flat route to one.
   */
  it('lists at a flat path and still opens a row under its zone', () => {
    const source = sourceOf(MEMBERSHIPS);
    const [first] = MEMBERSHIP_SEED;

    expect(source.path).toBe('/v1/admin/memberships');
    expect(source.pathParams).toBeUndefined();
    expect(source.collectionPath).toBeUndefined();
    expect(
      source.memberPath?.(compositeId([first.zoneId, first.membershipId]))
    ).toBe(`/v1/admin/zones/${first.zoneId}/members/${first.membershipId}`);
  });

  /**
   * A username and a role tell two rows apart only inside one household. Across
   * zones the household is the fact that does, so it is a column and it
   * survives to a phone.
   */
  it('names the household on every row', () => {
    expect(MEMBERSHIPS.list.columns[0]).toBe('zoneName');
    expect(MEMBERSHIPS.list.compact).toContain('zoneName');
    expect(fieldOf(MEMBERSHIPS, 'zoneName')?.editable).toBe(false);
    expect(MEMBERSHIP_SEED.every((row) => row.zoneName !== '')).toBe(true);
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
  it('locks the status and offers the verbs that move it', () => {
    expect(fieldOf(MEMBERSHIPS, 'status')?.editable).toBe(false);
    expect(fieldOf(MEMBERSHIPS, 'status')?.help).toBeDefined();
    // Handing the zone over is here too since admin plan 0045: the zone's
    // page used to declare it by hand, and one place declares an action.
    expect(namedActionsOf(MEMBERSHIPS).map((action) => action.name)).toEqual([
      'approve-member',
      'reject-member',
      'transfer-ownership',
      'kick-member',
      'ban-member',
    ]);
  });

  /**
   * Core refuses a kick and a ban against an owner, so neither is offered
   * against one, and only a waiting member can be let in or refused.
   */
  it('offers each verb only where core would accept it', () => {
    const [approve, reject, transfer, kick, ban] = namedActionsOf(MEMBERSHIPS);
    const [owner] = MEMBERSHIP_SEED.filter((row) => row.role === 'OWNER');
    const [waiting] = MEMBERSHIP_SEED.filter((row) => row.status === 'PENDING');
    const [member] = MEMBERSHIP_SEED.filter(
      (row) => row.role !== 'OWNER' && row.status === 'APPROVED'
    );

    // The fixture is what makes this test mean anything, so it is asserted.
    expect([owner, waiting, member]).not.toContain(undefined);

    // Nothing applies to an owner, which is why the owner's row has no menu.
    for (const action of [approve, reject, transfer, kick, ban]) {
      expect(action.available?.(owner)).toBe(false);
    }

    // A request is answered, and the zone is not handed to somebody who is
    // not in it yet.
    expect(approve.available?.(waiting)).toBe(true);
    expect(reject.available?.(waiting)).toBe(true);
    expect(transfer.available?.(waiting)).toBe(false);

    // Somebody in the zone can be handed it, removed or banned.
    expect(transfer.available?.(member)).toBe(true);
    expect(kick.available?.(member)).toBe(true);
    expect(ban.available?.(member)).toBe(true);
    expect(approve.available?.(member)).toBe(false);
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
    expect(MEMBERSHIPS.caution).toBe(ZONE_CAUTION);
  });
});

describe('the list line descriptor', () => {
  /** Admin plan 0045: a line sits under its list, which sits under its zone. */
  it('reads the list from the address, and offers no filter', () => {
    expect(LIST_LINES.segment).toBe('lines');
    expect(LIST_LINES.parent).toEqual({
      resource: 'lists',
      param: 'listId',
      filter: 'listId',
    });
    expect(LIST_LINES.filters).toBeUndefined();
  });

  it('lists at a flat path and still opens a row under its list', () => {
    const source = sourceOf(LIST_LINES);
    const [first] = LIST_LINE_SEED;

    expect(source.path).toBe('/v1/admin/list-lines');
    expect(source.pathParams).toBeUndefined();
    expect(source.collectionPath).toBeUndefined();
    expect(source.memberPath?.(compositeId([first.listId, first.id]))).toBe(
      `/v1/admin/lists/${first.listId}/lines/${first.id}`
    );
  });

  /** Two lines can say the same thing, and then the list is what tells them apart. */
  it('names the list on every row', () => {
    expect(LIST_LINES.list.columns[0]).toBe('listName');
    expect(LIST_LINES.list.compact).toContain('listName');
    expect(fieldOf(LIST_LINES, 'listName')?.editable).toBe(false);
    expect(LIST_LINE_SEED.every((row) => row.listName !== '')).toBe(true);
  });

  /**
   * `createdByUserId` is not nullable and an operator is not a user, so there
   * is no route that creates one. The list says so where the control would be,
   * rather than offering a button the gateway refuses.
   */
  it('offers no way to add a line', () => {
    // Who adds one is said by the list's own info button, on the page the
    // lines are drawn on (admin plan 0045, target 7).
    expect(LIST_LINES.actions?.create).toBeUndefined();
    expect(LIST_LINES.info).toBeUndefined();
  });

  it('locks the approval and offers the two acts that move it', () => {
    expect(fieldOf(LIST_LINES, 'approvalStatus')?.editable).toBe(false);
    expect(fieldOf(LIST_LINES, 'approvalStatus')?.help).toBeDefined();
    expect(namedActionsOf(LIST_LINES).map((action) => action.name)).toEqual([
      'approve-line',
      'reject-line',
    ]);
  });

  /** Admin plan 0045, target 5: on a line that waits, and on no other. */
  it('offers the two acts on a line that waits alone', () => {
    const line = (approvalStatus: string) =>
      ({ ...LIST_LINE_SEED[0], approvalStatus }) as ResourceRow;

    for (const action of namedActionsOf(LIST_LINES)) {
      expect(action.available?.(line('PENDING'))).toBe(true);
      expect(action.available?.(line('APPROVED'))).toBe(false);
      expect(action.available?.(line('REJECTED'))).toBe(false);
    }
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
    expect(LIST_LINES.caution).toBe(ZONE_CAUTION);
  });
});

describe('what plan 0009 deliberately left read only', () => {
  /**
   * A basket is output. Its lines carry origins that say where they came from
   * and settlements written against them, so a changed content or quantity
   * contradicts rows already on disk, inside one person's private document.
   */
  it('says on the basket screen that there is nothing to press', () => {
    expect(BASKETS.actions).toBeUndefined();
    expect(BASKETS.info?.points).toEqual([
      'people.baskets.info.record',
      'people.baskets.info.correct',
    ]);
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
      (descriptor) => descriptor.caution === ZONE_CAUTION
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
 * Plan 0017: a list with no parent chosen is an ordinary list.
 *
 * The screen used to state a missing filter instead of drawing anything, which
 * meant an operator had to know the household before they could look for the
 * person in it. Both lists now open across every parent, and choosing one
 * narrows them.
 */
describe('a list with no parent chosen', () => {
  const storeFor = (descriptor: AnyResourceDescriptor) =>
    TestBed.runInInjectionContext(
      () => new ResourceListStore(descriptor, descriptor.gateway())
    );

  it('lists memberships from every zone, and narrows to one', async () => {
    const store = storeFor(MEMBERSHIPS);
    await store.load();

    expect(store.rows().length).toBe(MEMBERSHIP_SEED.length);
    // The fixture spans more than one household, which is what makes the
    // assertion above mean anything.
    expect(
      new Set(MEMBERSHIP_SEED.map((row) => row.zoneId)).size
    ).toBeGreaterThan(1);

    await store.setFilter('zoneId', ZONE_SEED[0].id);

    expect(store.rows().length).toBe(
      MEMBERSHIP_SEED.filter((row) => row.zoneId === ZONE_SEED[0].id).length
    );
    expect(store.rows().length).toBeLessThan(MEMBERSHIP_SEED.length);
  });

  it('lists lines from every list, and narrows to one', async () => {
    const store = storeFor(LIST_LINES);
    await store.load();

    expect(store.rows().length).toBe(LIST_LINE_SEED.length);
    expect(
      new Set(LIST_LINE_SEED.map((row) => row.listId)).size
    ).toBeGreaterThan(1);

    await store.setFilter('listId', LIST_SEED[0].id);

    expect(store.rows().length).toBe(
      LIST_LINE_SEED.filter((row) => row.listId === LIST_SEED[0].id).length
    );
    expect(store.rows().length).toBeLessThan(LIST_LINE_SEED.length);
  });
});
