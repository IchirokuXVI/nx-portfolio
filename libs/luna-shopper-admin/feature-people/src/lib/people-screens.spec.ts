import { type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  DIRECTORY_SERVICE,
  GatewayError,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { RecordPage } from '@portfolio/luna-shopper-admin/feature-resource';
import { compositeId } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { LIST_SEED, USER_SEED, ZONE_SEED } from './people-seed';
import {
  bootShoppers,
  controlSaying,
  currentUrl,
  find,
  findAll,
  recordingDirectory,
  settle,
  ShoppersTestHost,
  textOf,
} from './shoppers.testing';

/**
 * The shoppers screens, rendered (plan 0007, section 6; admin plan 0045).
 *
 * Everything here runs against the in-memory gateway, and the section is
 * mounted where the app mounts it, so the links between a zone, its members,
 * a person and a list are the real ones. The one thing that is replaced is
 * the directory service, in the specs that are about whether an action was
 * *asked for* and *called*: the in-memory one would answer without recording
 * it.
 *
 * Assertions are on keys and not on sentences wherever a string is
 * interpolated: the testing translator does not interpolate.
 */

const [ROSA, MARC, , GUEST] = USER_SEED;
const [KITCHEN, ALLOTMENT] = ZONE_SEED;
const [WEEKLY] = LIST_SEED;

const PEOPLE = '/shoppers/people';
const ZONES = '/shoppers/zones';

const withDirectory = (directory: DirectoryServiceI) => [
  { provide: DIRECTORY_SERVICE, useValue: directory },
];

/** The record page that is open: the page of a person or of a zone. */
const recordPage = (fixture: ComponentFixture<unknown>): RecordPage =>
  fixture.debugElement.query(By.directive(RecordPage)).componentInstance;

/** The states beside the name in the header, as their keys. */
const headerStates = (fixture: ComponentFixture<unknown>) =>
  findAll(fixture, 'lib-record-page lib-page-header .chip').map((chip) => ({
    label: chip.textContent?.trim(),
    waiting: chip.classList.contains('waiting'),
  }));

/** The entries of the More menu, in the order they are drawn. */
const menuEntries = (fixture: ComponentFixture<unknown>) =>
  findAll(fixture, 'lib-record-page lib-page-header [data-action]').map(
    (entry) => entry.getAttribute('data-action')
  );

/** The question that is up, as the dialog holds it. */
const question = (fixture: ComponentFixture<unknown>): ConfirmDialog =>
  fixture.debugElement.query(By.directive(ConfirmDialog)).componentInstance;

/** A link of the page, found by the words it says. */
const linkSaying = (fixture: ComponentFixture<unknown>, label: string) =>
  findAll<HTMLAnchorElement>(fixture, 'lib-record-page a').find((link) =>
    link.textContent?.includes(label)
  );

describe('the Shoppers section', () => {
  it('opens on the People tab', async () => {
    await bootShoppers('/shoppers');

    expect(currentUrl()).toBe(PEOPLE);
  });

  it('says what a zone and a person are behind the info button', async () => {
    const fixture = await bootShoppers(PEOPLE);

    expect(textOf(fixture)).not.toContain('people.shoppers.info.zone');

    find<HTMLButtonElement>(fixture, 'lib-info-button button')?.click();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('people.shoppers.info.zone');
    expect(textOf(fixture)).toContain('people.shoppers.info.person');
  });
});

describe('the People tab', () => {
  it('draws one row per account, including two with the same username', async () => {
    const fixture = await bootShoppers(PEOPLE);

    const rows = findAll(fixture, '[data-row]');
    expect(rows).toHaveLength(USER_SEED.length);
    expect(
      rows.filter((row) => row.textContent?.includes('rosa@example.com'))
    ).toHaveLength(1);
    expect(
      rows.filter(
        (row) =>
          row.querySelector('.row-heading')?.textContent?.trim() === 'rosa'
      )
    ).toHaveLength(2);
  });

  /**
   * `displayName` is a real full name where an identity provider supplied one.
   * It is on the person's Details tab and not in a list anybody might
   * screenshot.
   */
  it('shows no display name anywhere on the listing', async () => {
    const fixture = await bootShoppers(PEOPLE);

    expect(textOf(fixture)).not.toContain('Rosa Iglesias');
    expect(textOf(fixture)).not.toContain('Marc Oliver');
  });

  it('marks a guest, and an address nobody confirmed', async () => {
    const fixture = await bootShoppers(PEOPLE);

    expect(textOf(fixture)).toContain('people.users.state.guest');
    expect(
      findAll(fixture, '.state-chip[data-tone="waiting"]').map((chip) =>
        chip.textContent?.trim()
      )
    ).toEqual(['people.users.state.unconfirmed']);
  });

  it('filters by role, from the address', async () => {
    const fixture = await bootShoppers(`${PEOPLE}?role=admin`);

    const rows = findAll(fixture, '[data-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('marc');
  });

  /** A role is only ever changed on the person's page, with a confirmation. */
  it('offers no way to change a role, and no way to make a person', async () => {
    const fixture = await bootShoppers(PEOPLE);

    expect(findAll(fixture, 'button[role="switch"]')).toHaveLength(0);
    expect(controlSaying(fixture, 'resource.action.create')).toBeUndefined();
  });

  it('opens a person on the Details tab', async () => {
    const fixture = await bootShoppers(PEOPLE);

    findAll(fixture, '[data-row]')[0].click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${PEOPLE}/${ROSA.userId}/details`);
  });
});

describe('a person', () => {
  it('redirects to the Details tab', async () => {
    await bootShoppers(`${PEOPLE}/${ROSA.userId}`);

    expect(currentUrl()).toBe(`${PEOPLE}/${ROSA.userId}/details`);
  });

  it('says in the header who, that it is a guest, and what waits', async () => {
    const confirmed = await bootShoppers(`${PEOPLE}/${ROSA.userId}`);
    expect(find(confirmed, 'lib-record-page .page-title')?.textContent).toBe(
      'rosa'
    );
    expect(headerStates(confirmed)).toEqual([]);

    // An admin says so. Amber for the address, because it is the one an
    // operator can do something about.
    const waiting = await bootShoppers(`${PEOPLE}/${MARC.userId}`);
    expect(headerStates(waiting)).toEqual([
      { label: 'people.users.roles.admin.name', waiting: false },
      { label: 'people.users.state.unconfirmed', waiting: true },
    ]);
    expect(
      find(waiting, 'lib-record-page lib-page-header .chip.good')?.textContent
    ).toContain('people.users.roles.admin.name');

    const guest = await bootShoppers(`${PEOPLE}/${GUEST.userId}`);
    expect(headerStates(guest)).toEqual([
      { label: 'people.users.state.guest', waiting: false },
    ]);
  });

  /** Target 5: "Not yet", in the row as well as in the header. */
  it('says "Not yet" on the row of an email nobody confirmed', async () => {
    const waiting = await bootShoppers(`${PEOPLE}/${MARC.userId}/details`);
    expect(
      findAll(waiting, '[data-check]').map((mark) => mark.textContent)
    ).toEqual([expect.stringContaining('people.users.notConfirmed')]);

    const confirmed = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);
    expect(find(confirmed, '[data-check]')).toBeNull();
  });

  it('draws the account and its access as two sections, and the roles as words', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${MARC.userId}/details`);
    const text = textOf(fixture);

    expect(text).toContain('people.users.section.account');
    expect(text).toContain('people.users.section.access');
    expect(text).toContain('people.users.roles.cell.admin');
    expect(text).toContain('people.users.hasPassword');
    expect(text).toContain('people.users.providers');
    // "Signed up" and not "Added", and the ID in the Record block alone.
    expect(find(fixture, '[data-fact="added"]')?.textContent).toContain(
      'people.users.record.signedUp'
    );
    expect(find(fixture, '[data-fact="id"]')?.textContent).toContain(
      MARC.userId
    );
    // Nothing on a page that reads writes.
    expect(findAll(fixture, '[role="switch"]')).toHaveLength(0);
  });

  it('links to the zones the account owns and to the ones it is in', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);

    expect(
      linkSaying(fixture, 'people.users.record.zonesOwned')?.getAttribute(
        'href'
      )
    ).toBe(`${ZONES}?ownerUserId=${ROSA.userId}`);
    expect(
      linkSaying(fixture, 'people.users.record.zonesJoined')?.getAttribute(
        'href'
      )
    ).toBe(`${ZONES}?userId=${ROSA.userId}`);
  });

  it('shows the display name on the Details tab, where a list would not', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);

    expect(textOf(fixture)).toContain('Rosa Iglesias');
    expect(textOf(fixture)).toContain('rosa@example.com');
  });

  it('has three tabs, each under the person', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}`);

    expect(
      findAll(fixture, 'lib-record-page lib-page-tabs a').map((tab) =>
        tab.getAttribute('href')
      )
    ).toEqual([
      `${PEOPLE}/${ROSA.userId}/details`,
      `${PEOPLE}/${ROSA.userId}/zones`,
      `${PEOPLE}/${ROSA.userId}/shopping-lists`,
    ]);
  });

  it('turns Details into a form on Edit, from whichever tab is open', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/zones`);

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${PEOPLE}/${ROSA.userId}/details`);
    expect(recordPage(fixture).store().mode()).toBe('edit');
  });

  /** The old address of the form, which links out in the world still name. */
  it('leads the old address of the form to Details as a form', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/edit`);
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${PEOPLE}/${ROSA.userId}/details`);
    expect(recordPage(fixture).store().mode()).toBe('edit');
  });

  it('puts every action in the More menu, and the one that destroys last', async () => {
    const waiting = await bootShoppers(`${PEOPLE}/${MARC.userId}`);

    // marc holds the admin role and has not confirmed his address.
    expect(menuEntries(waiting)).toEqual([
      'resend-verification',
      'take-role-admin',
      'give-role-premium',
      'delete-account',
    ]);
    expect(
      findAll(waiting, 'lib-record-page [pageMoreDanger][data-action]').map(
        (entry) => entry.getAttribute('data-action')
      )
    ).toEqual(['delete-account']);
  });

  it('offers no resend for an address that is already confirmed', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}`);

    expect(find(fixture, '[data-action="resend-verification"]')).toBeNull();
  });

  it('resends a confirmation once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${MARC.userId}`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="resend-verification"]')?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    controlSaying(
      fixture,
      'people.users.confirm.resendVerification.confirm'
    )?.click();
    await settle(fixture);

    expect(calls).toEqual([`resend:${MARC.userId}`]);
  });

  /** Every action is confirmed, and nothing happens until the operator says yes. */
  it('asks before it deletes an account, and then goes to the list', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${ROSA.userId}`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="delete-account"]')?.click();
    await settle(fixture);

    expect(textOf(fixture)).toContain(
      'people.users.confirm.deleteAccount.heading'
    );
    // It names the account, and the button that goes through is red.
    expect(question(fixture).bodyArgs()).toEqual({ name: 'rosa' });
    expect(question(fixture).tone()).toBe('danger');
    expect(calls).toEqual([]);

    controlSaying(
      fixture,
      'people.users.confirm.deleteAccount.confirm'
    )?.click();
    await settle(fixture);
    await settle(fixture);

    expect(calls).toEqual([`deleteUser:${ROSA.userId}`]);
    expect(currentUrl()).toBe(PEOPLE);
  });

  it('leaves the account alone when the confirmation is dismissed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${ROSA.userId}`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="delete-account"]')?.click();
    await settle(fixture);
    controlSaying(fixture, 'resource.action.cancel')?.click();
    await settle(fixture);

    expect(calls).toEqual([]);
    expect(textOf(fixture)).not.toContain(
      'people.users.confirm.deleteAccount.heading'
    );
  });

  /**
   * Users are in auth's database and zones are in core's. The zones here are
   * the zone listing narrowed to the person, and what the person is in each
   * comes from that zone's own read.
   */
  it('lists the zones the person is in, with their role and state there', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${MARC.userId}/zones`);
    await settle(fixture);

    const rows = findAll(fixture, '[data-zones] .row');
    expect(rows.map((row) => row.querySelector('a')?.textContent)).toEqual([
      'Kitchen',
      'Allotment',
    ]);
    expect(rows[0].textContent).toContain('people.zones.role.MEMBER');
    expect(rows[0].textContent).toContain('people.zones.membership.APPROVED');
    expect(rows[1].textContent).toContain('people.zones.role.ADMIN');
  });

  it('opens a zone from the Zones tab', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${MARC.userId}/zones`);
    await settle(fixture);

    expect(find(fixture, '[data-zones] .row a')?.getAttribute('href')).toBe(
      `${ZONES}/${KITCHEN.id}`
    );
  });

  it('lists the shopping lists the person owns, and opens one under them', async () => {
    const fixture = await bootShoppers(
      `${PEOPLE}/${ROSA.userId}/shopping-lists`
    );

    expect(textOf(fixture)).toContain('Saturday');
    // The owner is the address, so it is no filter on the tab.
    expect(textOf(fixture)).not.toContain('people.baskets.filter.ownerUserId');

    find(fixture, 'lib-resource-list button.title')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(
      `${PEOPLE}/${ROSA.userId}/shopping-lists/b-saturday`
    );
    expect(textOf(fixture)).toContain('Bread');
  });
});

/**
 * An account's roles (admin plans 0038 and 0057, on backend plan 0175).
 *
 * The in memory gateway holds one account with a role, `marc` with `admin`, so
 * the column, the filter and an entry that takes a role away each have something
 * to show with no server.
 */
describe("an account's roles", () => {
  /** A role is words on the page, and it changes in the More menu alone. */
  it('offers to give a role the account lacks, and to take away one it holds', async () => {
    const admin = await bootShoppers(`${PEOPLE}/${MARC.userId}/details`);
    expect(menuEntries(admin)).toEqual(
      expect.arrayContaining(['take-role-admin', 'give-role-premium'])
    );
    expect(menuEntries(admin)).not.toContain('give-role-admin');
    expect(menuEntries(admin)).not.toContain('take-role-premium');

    const plain = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);
    expect(menuEntries(plain)).toEqual(
      expect.arrayContaining(['give-role-admin', 'give-role-premium'])
    );
    expect(textOf(plain)).toContain('people.users.roles.cell.none');
  });

  it('gives a role once confirmed, and the page then says it', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);

    find(fixture, '[data-action="give-role-admin"]')?.click();
    await settle(fixture);

    expect(textOf(fixture)).toContain('people.users.confirm.grantRole.heading');
    // The question says what the role grants and when the account gets it.
    expect(textOf(fixture)).toContain(
      'people.users.confirm.grantRole.body.admin'
    );
    expect(question(fixture).bodyArgs()).toEqual({ name: 'rosa' });
    // A role is given back or taken away as easily, so the button is not red.
    expect(question(fixture).tone()).toBe('primary');
    // Nothing moves until the operator says yes.
    expect(textOf(fixture)).toContain('people.users.roles.cell.none');

    controlSaying(fixture, 'people.users.confirm.grantRole.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(textOf(fixture)).toContain('people.users.roles.cell.admin');
    expect(menuEntries(fixture)).toContain('take-role-admin');
    expect(menuEntries(fixture)).not.toContain('give-role-admin');
  });

  it('removes a role by sending the whole set without it', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${MARC.userId}/details`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="take-role-admin"]')?.click();
    await settle(fixture);
    expect(textOf(fixture)).toContain(
      'people.users.confirm.removeRole.heading'
    );
    expect(textOf(fixture)).toContain(
      'people.users.confirm.removeRole.body.admin'
    );

    controlSaying(fixture, 'people.users.confirm.removeRole.confirm')?.click();
    await settle(fixture);

    expect(calls).toEqual([`roles:${MARC.userId}:`]);
  });

  it('sends the roles already held beside the one granted', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${MARC.userId}/details`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="give-role-premium"]')?.click();
    await settle(fixture);
    controlSaying(fixture, 'people.users.confirm.grantRole.confirm')?.click();
    await settle(fixture);

    expect(calls).toEqual([`roles:${MARC.userId}:admin,premium`]);
  });

  it('changes nothing when the confirmation is dismissed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${ROSA.userId}/details`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="give-role-admin"]')?.click();
    await settle(fixture);
    controlSaying(fixture, 'resource.action.cancel')?.click();
    await settle(fixture);

    expect(calls).toEqual([]);
    expect(find(fixture, 'lib-confirm-dialog')).toBeNull();
  });

  /** A guest has no roles (admin plan 0045, constraints). */
  it('offers a guest no role', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${GUEST.userId}/details`);

    expect(
      menuEntries(fixture).filter((name) => name?.includes('role'))
    ).toEqual([]);
    expect(menuEntries(fixture)).toContain('delete-account');
  });

  /**
   * The server's refusal for a guest, named and not the generic conflict. The
   * menu offers a guest no role, so reaching this takes a stale screen; the
   * memory twin refuses the same way auth does. It is said on whichever tab
   * is open, because the More menu is over every one of them.
   */
  it.each(['details', 'zones'])(
    'says why the server refused a guest, on the tab %s',
    async (tab) => {
      const { directory } = recordingDirectory();
      const refusing: DirectoryServiceI = {
        ...directory,
        setUserRoles: async () => {
          throw new GatewayError({
            code: 'guest_has_no_roles',
            status: 409,
            correlationId: '',
          });
        },
      };
      const fixture = await bootShoppers(
        `${PEOPLE}/${ROSA.userId}/${tab}`,
        withDirectory(refusing)
      );

      find(fixture, '[data-action="give-role-admin"]')?.click();
      await settle(fixture);
      controlSaying(fixture, 'people.users.confirm.grantRole.confirm')?.click();
      await settle(fixture);
      await settle(fixture);

      expect(find(fixture, '[data-refusal]')?.textContent).toContain(
        'resource.error.guestHasNoRoles'
      );
      expect(currentUrl()).toBe(`${PEOPLE}/${ROSA.userId}/${tab}`);
    }
  );
});

describe('the Zones tab', () => {
  /**
   * Plan 0074, section 3: a listing never fails because a decoration failed,
   * and an owner id that resolved to nobody is drawn as the id.
   */
  it('renders every zone, including one whose owner did not resolve', async () => {
    const fixture = await bootShoppers(ZONES);

    const rows = findAll(fixture, '[data-row]');
    expect(rows).toHaveLength(ZONE_SEED.length);
    expect(textOf(fixture)).toContain('Kitchen');
    expect(textOf(fixture)).toContain('Allotment');
    // Who owns it and how much is in it, as one sentence under the name. The
    // second zone's owner resolved to nobody, and the sentence then leaves
    // the owner out: an owner is said by name and never by ID.
    expect(
      rows.map((row) => row.querySelector('.row-line')?.textContent?.trim())
    ).toEqual([
      expect.stringContaining('people.zones.brief.owned'),
      expect.stringContaining('people.zones.brief.counts'),
    ]);
  });

  it('says on a row how many requests wait, and that a zone is marked', async () => {
    const fixture = await bootShoppers(ZONES);
    const [kitchen, allotment] = findAll(fixture, '[data-row]');

    expect(
      kitchen.querySelector('.state-chip[data-tone="waiting"]')?.textContent
    ).toContain('people.zones.state.requests');
    expect(
      allotment.querySelector('.state-chip[data-tone="waiting"]')
    ).toBeNull();
    expect(allotment.textContent).toContain(
      'people.zones.status.MARKED_FOR_DELETION'
    );
  });

  /** Admin plan 0045, section 2: the filter the Overview's tile opens with. */
  it('shows only the zones with a request when asked for those', async () => {
    const fixture = await bootShoppers(`${ZONES}?hasPending=true`);

    const rows = findAll(fixture, '[data-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Kitchen');
  });

  it('offers no way to make a zone', async () => {
    const fixture = await bootShoppers(ZONES);

    expect(controlSaying(fixture, 'resource.action.create')).toBeUndefined();
  });
});

describe('a zone', () => {
  it('redirects to the Members tab', async () => {
    await bootShoppers(`${ZONES}/${KITCHEN.id}`);

    expect(currentUrl()).toBe(`${ZONES}/${KITCHEN.id}/members`);
  });

  /**
   * The owner and the join code are fields of Details now (admin plan 0057,
   * section 5). The header keeps the states that say something waits or is
   * wrong.
   */
  it('says in the header which zone, and what waits or is marked', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);

    expect(find(fixture, 'lib-record-page .page-title')?.textContent).toBe(
      'Kitchen'
    );
    expect(headerStates(fixture)).toEqual([
      { label: 'people.zones.state.requests', waiting: true },
    ]);

    const marked = await bootShoppers(`${ZONES}/${ALLOTMENT.id}`);
    expect(headerStates(marked)).toEqual([
      { label: 'people.zones.status.MARKED_FOR_DELETION', waiting: false },
    ]);
    // In red, as the page of a zone always drew it.
    expect(
      find(marked, 'lib-record-page lib-page-header .chip.danger')?.textContent
    ).toContain('people.zones.status.MARKED_FOR_DELETION');
  });

  it('draws the owner on Details as a link to the person, by name', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/details`);
    await settle(fixture);

    const owner = findAll<HTMLAnchorElement>(
      fixture,
      'lib-record-page lib-record-view a'
    ).find(
      (link) => link.getAttribute('href') === `${PEOPLE}/${KITCHEN.ownerUserId}`
    );
    expect(owner?.textContent?.trim()).toBe('rosa');
  });

  /** An owner whose account is gone is never drawn as its bare ID. */
  it('never draws an owner it cannot name as an ID', async () => {
    const fixture = await bootShoppers(`${ZONES}/${ALLOTMENT.id}/details`);
    await settle(fixture);

    expect(textOf(fixture)).not.toContain(String(ALLOTMENT.ownerUserId));
    expect(textOf(fixture)).toContain('record.value.gone');
  });

  it('has four tabs, each under the zone, with the counts the read carries', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);
    const tabs = findAll(fixture, 'lib-record-page lib-page-tabs a');

    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      `${ZONES}/${KITCHEN.id}/members`,
      `${ZONES}/${KITCHEN.id}/lists`,
      `${ZONES}/${KITCHEN.id}/shopping-lists`,
      `${ZONES}/${KITCHEN.id}/details`,
    ]);
    expect(tabs.map((tab) => tab.querySelector('.count')?.textContent)).toEqual(
      [
        String(KITCHEN.memberCount),
        String(KITCHEN.listCount),
        undefined,
        undefined,
      ]
    );
  });

  it('turns Details into a form on Edit, with the one caution above it', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);

    expect(find(fixture, '[data-caution]')).toBeNull();

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${ZONES}/${KITCHEN.id}/details`);
    expect(recordPage(fixture).store().mode()).toBe('edit');
    expect(find(fixture, '[data-caution]')?.textContent).toContain(
      'people.zoneCaution'
    );
  });

  /** The old address of the form, which links out in the world still name. */
  it('leads the old address of the form to Details as a form', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/edit`);
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${ZONES}/${KITCHEN.id}/details`);
    expect(recordPage(fixture).store().mode()).toBe('edit');
  });

  it('puts every action in the More menu, the ones that harm in red and the delete last', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);

    expect(menuEntries(fixture)).toEqual([
      'regenerate-join-code',
      'mark-for-deletion',
      'delete-zone',
    ]);
    expect(
      findAll(fixture, 'lib-record-page [pageMoreDanger][data-action]').map(
        (entry) => entry.getAttribute('data-action')
      )
    ).toEqual(['regenerate-join-code', 'mark-for-deletion', 'delete-zone']);
  });

  it('offers marking for an active zone and restoring for a marked one', async () => {
    const active = await bootShoppers(`${ZONES}/${KITCHEN.id}`);
    expect(find(active, '[data-action="mark-for-deletion"]')).not.toBeNull();
    expect(find(active, '[data-action="restore-zone"]')).toBeNull();

    const marked = await bootShoppers(`${ZONES}/${ALLOTMENT.id}`);
    expect(find(marked, '[data-action="mark-for-deletion"]')).toBeNull();
    expect(find(marked, '[data-action="restore-zone"]')).not.toBeNull();
  });

  it('replaces the join code once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${ZONES}/${KITCHEN.id}`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="regenerate-join-code"]')?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    controlSaying(
      fixture,
      'people.zones.confirm.regenerateJoinCode.confirm'
    )?.click();
    await settle(fixture);

    expect(calls).toEqual([`joinCode:${KITCHEN.id}`]);
  });

  /** "Restore" stays without a confirmation: it is the undo. */
  it('restores a marked zone on the press, with no question', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${ZONES}/${ALLOTMENT.id}`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="restore-zone"]')?.click();
    await settle(fixture);

    expect(find(fixture, 'lib-confirm-dialog')).toBeNull();
    expect(calls).toEqual([`mark:${ALLOTMENT.id}:false`]);
  });

  it('deletes the zone once confirmed, and then goes to the list', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${ZONES}/${KITCHEN.id}`,
      withDirectory(directory)
    );

    find(fixture, '[data-action="delete-zone"]')?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    controlSaying(fixture, 'people.zones.confirm.deleteZone.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(calls).toEqual([`deleteZone:${KITCHEN.id}`]);
    expect(currentUrl()).toBe(ZONES);
  });

  it('shows the facts and the configuration on the Details tab', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/details`);

    expect(textOf(fixture)).toContain('people.zones.joinCode');
    expect(textOf(fixture)).toContain(KITCHEN.joinCode);
    expect(textOf(fixture)).toContain('people.zones.config');
    expect(textOf(fixture)).toContain('people.zones.pendingCount');
    expect(textOf(fixture)).toContain('people.zones.section.zone');
    expect(textOf(fixture)).toContain('people.zones.section.state');
    expect(textOf(fixture)).toContain('people.zones.section.settings');
    expect(find(fixture, '[data-fact="id"]')?.textContent).toContain(
      KITCHEN.id
    );
  });

  /** The new code is read with the zone again, and no reload is needed. */
  it('shows the new join code after it is replaced', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/details`);

    find(fixture, '[data-action="regenerate-join-code"]')?.click();
    await settle(fixture);
    controlSaying(
      fixture,
      'people.zones.confirm.regenerateJoinCode.confirm'
    )?.click();
    await settle(fixture);
    await settle(fixture);

    expect(textOf(fixture)).not.toContain(KITCHEN.joinCode);
  });

  it('follows a mark and a restore in the header', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);
    const marked = () =>
      headerStates(fixture).some(
        (state) => state.label === 'people.zones.status.MARKED_FOR_DELETION'
      );

    find(fixture, '[data-action="mark-for-deletion"]')?.click();
    await settle(fixture);
    controlSaying(
      fixture,
      'people.zones.confirm.markForDeletion.confirm'
    )?.click();
    await settle(fixture);
    await settle(fixture);
    expect(marked()).toBe(true);

    find(fixture, '[data-action="restore-zone"]')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(marked()).toBe(false);
  });
});

describe('the Members tab of a zone', () => {
  const [owner, member, waiting] = KITCHEN.members;
  const row = (fixture: ComponentFixture<ShoppersTestHost>, id: string) =>
    find(fixture, `[data-member="${id}"]`) as HTMLElement;

  it('puts the requests that wait first, on the waiting wash', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);
    const rows = findAll(fixture, '[data-members] > .row');

    expect(rows.map((entry) => entry.getAttribute('data-member'))).toEqual([
      waiting.membershipId,
      owner.membershipId,
      member.membershipId,
    ]);
    expect(rows[0].classList).toContain('waiting');
    expect(rows[1].classList).not.toContain('waiting');
  });

  it('offers Reject and Approve on a request, and no menu', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);
    const request = row(fixture, waiting.membershipId);

    expect(
      [...request.querySelectorAll('[data-action]')].map((button) =>
        button.getAttribute('data-action')
      )
    ).toEqual(['approve-member', 'reject-member']);
    expect(request.querySelector('[data-member-menu]')).toBeNull();
  });

  it('approves a request once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${ZONES}/${KITCHEN.id}/members`,
      withDirectory(directory)
    );

    row(fixture, waiting.membershipId)
      .querySelector<HTMLButtonElement>('[data-action="approve-member"]')
      ?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    controlSaying(
      fixture,
      'people.memberships.confirm.approve.confirm'
    )?.click();
    await settle(fixture);

    expect(calls).toEqual([`approve:${KITCHEN.id}:${waiting.membershipId}`]);
  });

  /** Against the memory twin, which does what the service does. */
  it('moves an approved request down among the members, and counts it', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);

    row(fixture, waiting.membershipId)
      .querySelector<HTMLButtonElement>('[data-action="approve-member"]')
      ?.click();
    await settle(fixture);
    controlSaying(
      fixture,
      'people.memberships.confirm.approve.confirm'
    )?.click();
    await settle(fixture);
    await settle(fixture);

    expect(row(fixture, waiting.membershipId).classList).not.toContain(
      'waiting'
    );
    expect(
      find(fixture, 'lib-record-page lib-page-tabs a .count')?.textContent
    ).toBe(String(KITCHEN.memberCount + 1));
  });

  it('links each name to the person', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);

    expect(
      row(fixture, member.membershipId)
        .querySelector('a.row-title')
        ?.getAttribute('href')
    ).toBe(`${PEOPLE}/${member.userId}`);
  });

  /**
   * An owner cannot be removed or banned (admin plan 0045, constraints). Core
   * refuses both, and the descriptor offers neither, so the row has no menu.
   */
  it('gives the owner row no menu', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);
    const ownerRow = row(fixture, owner.membershipId);

    expect(ownerRow.textContent).toContain('people.zones.role.OWNER');
    expect(ownerRow.querySelector('[data-member-menu]')).toBeNull();
    expect(ownerRow.querySelector('[data-action]')).toBeNull();
  });

  it('holds the person, the form and the three actions in a member menu', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);

    row(fixture, member.membershipId)
      .querySelector<HTMLButtonElement>('[data-member-menu]')
      ?.click();
    await settle(fixture);

    const items = findAll(fixture, 'lib-popover-sheet .menu-item');
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'people.memberships.openPerson',
      'people.memberships.action.transfer',
      'people.memberships.change',
      'people.memberships.action.kick',
      'people.memberships.action.ban',
    ]);
    // "Change role or name" says a change, so it opens the form.
    expect(find(fixture, '[data-link="change"]')?.getAttribute('href')).toBe(
      `${ZONES}/${KITCHEN.id}/members/${compositeId([
        KITCHEN.id,
        member.membershipId,
      ])}?edit=1`
    );
    // The person is opened to be read.
    expect(
      find(fixture, '[data-link="person"]')?.getAttribute('href')
    ).not.toContain('edit=1');
  });

  it('opens the form of a member from "Change role or name"', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);

    row(fixture, member.membershipId)
      .querySelector<HTMLButtonElement>('[data-member-menu]')
      ?.click();
    await settle(fixture);
    find<HTMLAnchorElement>(fixture, '[data-link="change"]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(find(fixture, 'lib-record-view lib-field-control')).not.toBeNull();
  });

  it('bans a member through the service, once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${ZONES}/${KITCHEN.id}/members`,
      withDirectory(directory)
    );

    row(fixture, member.membershipId)
      .querySelector<HTMLButtonElement>('[data-member-menu]')
      ?.click();
    await settle(fixture);
    // Red in the menu and red in the question, because the descriptor says
    // `danger`. Nothing here names the action a second time.
    expect(
      findAll(fixture, '.menu-item.danger').map((item) =>
        item.getAttribute('data-action')
      )
    ).toEqual(['transfer-ownership', 'kick-member', 'ban-member']);
    find(fixture, '.menu-item[data-action="ban-member"]')?.click();
    await settle(fixture);
    expect(calls).toEqual([]);
    expect(question(fixture).tone()).toBe('danger');

    controlSaying(fixture, 'people.memberships.confirm.ban.confirm')?.click();
    await settle(fixture);

    expect(calls).toEqual([`ban:${KITCHEN.id}:${member.membershipId}`]);
  });

  it('hands the zone over through the service, once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${ZONES}/${KITCHEN.id}/members`,
      withDirectory(directory)
    );

    row(fixture, member.membershipId)
      .querySelector<HTMLButtonElement>('[data-member-menu]')
      ?.click();
    await settle(fixture);
    find(fixture, '.menu-item[data-action="transfer-ownership"]')?.click();
    await settle(fixture);
    controlSaying(
      fixture,
      'people.memberships.confirm.transfer.confirm'
    )?.click();
    await settle(fixture);

    expect(calls).toEqual([`transfer:${KITCHEN.id}:${member.membershipId}`]);
  });

  it('says once that the zone sees a change at once', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/members`);

    expect(findAll(fixture, 'lib-caution-line')).toHaveLength(1);
    expect(find(fixture, 'lib-caution-line')?.textContent).toContain(
      'people.zoneCaution'
    );
  });

  it('opens a member to be read, and goes back to the Members tab', async () => {
    const address = `${ZONES}/${KITCHEN.id}/members/${compositeId([
      KITCHEN.id,
      member.membershipId,
    ])}`;
    const fixture = await bootShoppers(address);

    // The record page (admin plan 0053): read first, and no control.
    expect(find(fixture, 'lib-record-view')).not.toBeNull();
    expect(find(fixture, 'lib-field-control')).toBeNull();
    // The zone is never typed here, so its help is under the value it reads.
    expect(textOf(fixture)).toContain('people.memberships.zoneIdHelp');

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);
    // "Edit" turns the same page into a form, with the one caution in sight.
    expect(find(fixture, 'lib-field-control')).not.toBeNull();
    expect(find(fixture, 'lib-record-view [data-caution]')).not.toBeNull();
    // The zone is the address, so the page does not ask for it again.
    expect(textOf(fixture)).not.toContain('people.memberships.zoneIdHelp');

    find<HTMLAnchorElement>(fixture, 'lib-record-page .page-back')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${ZONES}/${KITCHEN.id}/members`);
  });
});

describe('the Lists tab of a zone', () => {
  it('lists the lists of the zone with their line counts, and no contents', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/lists`);

    expect(textOf(fixture)).toContain('Weekly shop');
    expect(textOf(fixture)).toContain('people.lists.lineCount');
    // The list of the other zone is not here.
    expect(textOf(fixture)).not.toContain('Seeds');
    expect(textOf(fixture)).not.toContain('Milk, two litres');
    // The zone is the address, so it is no filter and no column.
    expect(textOf(fixture)).not.toContain('people.lists.zone');
  });

  it('offers no way to make a list', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/lists`);

    expect(controlSaying(fixture, 'resource.action.create')).toBeUndefined();
  });

  it('opens a list under its zone', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/lists`);

    find(fixture, 'lib-resource-list button.title')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${ZONES}/${KITCHEN.id}/lists/${WEEKLY.id}`);
  });
});

/**
 * A zone or a person that cannot be read says so, under the section's own
 * name. It used to keep "Loading" as its heading, with "Edit" beside it.
 */
describe('a person and a zone that cannot be read', () => {
  it.each([`${PEOPLE}/nobody`, `${ZONES}/nowhere`])(
    'says so at %s, with no Edit, no menu and no tabs',
    async (url) => {
      const fixture = await bootShoppers(url);
      await settle(fixture);

      const page = 'lib-record-page';
      expect(find(fixture, `${page} [data-missing]`)).not.toBeNull();
      expect(find(fixture, `${page} [data-edit]`)).toBeNull();
      expect(find(fixture, `${page} [data-action]`)).toBeNull();
      expect(find(fixture, `${page} lib-page-tabs a`)).toBeNull();
    }
  );
});

describe('the Shopping lists tab of a zone', () => {
  it('lists the shopping lists drawn from the zone', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/shopping-lists`);

    expect(textOf(fixture)).toContain('Saturday');
    // The zone is the address, so it is no filter on the tab.
    expect(textOf(fixture)).not.toContain('people.baskets.filter.zoneId');
  });

  /** A shopping list belongs to a person, so the row opens under its owner. */
  it('opens a shopping list under its owner', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}/shopping-lists`);

    find(fixture, 'lib-resource-list button.title')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(
      `${PEOPLE}/${ROSA.userId}/shopping-lists/b-saturday`
    );
  });
});
