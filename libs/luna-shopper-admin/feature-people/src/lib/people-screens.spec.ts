import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  DIRECTORY_SERVICE,
  GatewayError,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { compositeId } from '@portfolio/luna-shopper-admin/models';
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

  it('says in the header who, what kind of account, and what waits', async () => {
    const confirmed = await bootShoppers(`${PEOPLE}/${ROSA.userId}`);
    expect(find(confirmed, 'lib-person-page .page-title')?.textContent).toBe(
      'rosa'
    );
    expect(find(confirmed, '[data-kind]')?.textContent).toContain(
      'people.users.kind.REGISTERED'
    );
    expect(find(confirmed, '[data-unconfirmed]')).toBeNull();

    const waiting = await bootShoppers(`${PEOPLE}/${MARC.userId}`);
    expect(find(waiting, '[data-unconfirmed]')?.textContent).toContain(
      'people.users.state.unconfirmed'
    );

    const guest = await bootShoppers(`${PEOPLE}/${GUEST.userId}`);
    expect(find(guest, '[data-kind]')?.textContent).toContain(
      'people.users.kind.TEMPORARY'
    );
  });

  it('shows the display name on the Details tab, where a list would not', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);

    expect(textOf(fixture)).toContain('Rosa Iglesias');
    expect(textOf(fixture)).toContain('rosa@example.com');
  });

  it('has three tabs, each under the person', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}`);

    expect(
      findAll(fixture, 'lib-person-page lib-page-tabs a').map((tab) =>
        tab.getAttribute('href')
      )
    ).toEqual([
      `${PEOPLE}/${ROSA.userId}/details`,
      `${PEOPLE}/${ROSA.userId}/zones`,
      `${PEOPLE}/${ROSA.userId}/shopping-lists`,
    ]);
  });

  it('links Edit to the form, which goes back to the person', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}`);

    expect(find(fixture, '[data-edit]')?.getAttribute('href')).toBe(
      `${PEOPLE}/${ROSA.userId}/edit`
    );

    await TestBed.inject(Router).navigateByUrl(`${PEOPLE}/${ROSA.userId}/edit`);
    await settle(fixture);
    await settle(fixture);
    expect(find(fixture, 'lib-resource-form')).not.toBeNull();

    find<HTMLButtonElement>(
      fixture,
      'lib-resource-form-page .page-back'
    )?.click();
    await settle(fixture);
    await settle(fixture);
    expect(currentUrl()).toBe(`${PEOPLE}/${ROSA.userId}/details`);
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

/** The role switches of the Details tab, in the order the server lists roles. */
const switches = (fixture: ComponentFixture<ShoppersTestHost>) =>
  findAll<HTMLButtonElement>(fixture, 'button[role="switch"]');

/**
 * An account's roles (admin plan 0038, on backend plan 0175).
 *
 * The in memory gateway holds one account with a role, `marc` with `admin`, so
 * the column, the filter and a switch that is already on each have something
 * to show with no server.
 */
describe("an account's roles", () => {
  it('draws a switch per role, on where the account holds it', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${MARC.userId}/details`);

    expect(
      switches(fixture).map((button) => button.getAttribute('aria-checked'))
    ).toEqual(['true', 'false']);
    expect(textOf(fixture)).toContain('people.users.roles.admin.grants');
    expect(textOf(fixture)).toContain('people.users.roles.premium.grants');
  });

  it('grants a role once confirmed, and says when the account sees it', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${ROSA.userId}/details`);

    switches(fixture)[0].click();
    await settle(fixture);

    expect(textOf(fixture)).toContain('people.users.confirm.grantRole.heading');
    // Nothing moves until the operator says yes.
    expect(switches(fixture)[0].getAttribute('aria-checked')).toBe('false');

    controlSaying(fixture, 'people.users.confirm.grantRole.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(switches(fixture)[0].getAttribute('aria-checked')).toBe('true');
    expect(textOf(fixture)).toContain('people.users.roles.saved');
  });

  it('removes a role by sending the whole set without it', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(
      `${PEOPLE}/${MARC.userId}/details`,
      withDirectory(directory)
    );

    switches(fixture)[0].click();
    await settle(fixture);
    expect(textOf(fixture)).toContain(
      'people.users.confirm.removeRole.heading'
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

    switches(fixture)[1].click();
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

    switches(fixture)[0].click();
    await settle(fixture);
    controlSaying(fixture, 'resource.action.cancel')?.click();
    await settle(fixture);

    expect(calls).toEqual([]);
    expect(textOf(fixture)).not.toContain('people.users.roles.saved');
  });

  /** A guest has no roles (admin plan 0045, constraints). */
  it('shows a guest the switches off, and why', async () => {
    const fixture = await bootShoppers(`${PEOPLE}/${GUEST.userId}/details`);

    expect(textOf(fixture)).toContain('people.users.roles.guest');
    expect(switches(fixture)).toHaveLength(2);
    expect(switches(fixture).every((button) => button.disabled)).toBe(true);
  });

  /**
   * The server's refusal for a guest, named and not the generic conflict. The
   * tab turns the switches off for a guest, so reaching this takes a stale
   * screen; the memory twin refuses the same way auth does.
   */
  it('says why the server refused a guest', async () => {
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
      `${PEOPLE}/${ROSA.userId}/details`,
      withDirectory(refusing)
    );

    switches(fixture)[0].click();
    await settle(fixture);
    controlSaying(fixture, 'people.users.confirm.grantRole.confirm')?.click();
    await settle(fixture);

    expect(find(fixture, '[role="alert"]')?.textContent).toContain(
      'people.users.roles.guestRefused'
    );
    expect(textOf(fixture)).not.toContain('people.users.roles.saved');
  });
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
    // second zone's owner resolved to nobody, and the sentence still names
    // the id it could not resolve.
    expect(
      rows.map((row) => row.querySelector('.row-line')?.textContent?.trim())
    ).toEqual([
      expect.stringContaining('people.zones.brief.owned'),
      expect.stringContaining('people.zones.brief.owned'),
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

  it('says in the header who owns it, as a link, and its join code', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);

    expect(find(fixture, 'lib-zone-page .page-title')?.textContent).toBe(
      'Kitchen'
    );
    expect(find(fixture, '[data-owner]')?.getAttribute('href')).toBe(
      `${PEOPLE}/${KITCHEN.ownerUserId}`
    );
    expect(find(fixture, '[data-join-code]')?.textContent).toBe(
      KITCHEN.joinCode
    );
    expect(find(fixture, '[data-join-code]')?.classList).toContain('mono');
  });

  it('has four tabs, each under the zone, with the counts the read carries', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);
    const tabs = findAll(fixture, 'lib-zone-page lib-page-tabs a');

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

  it('links Edit zone to the form, which shows the one caution', async () => {
    const fixture = await bootShoppers(`${ZONES}/${KITCHEN.id}`);

    expect(find(fixture, '[data-edit]')?.getAttribute('href')).toBe(
      `${ZONES}/${KITCHEN.id}/edit`
    );

    await TestBed.inject(Router).navigateByUrl(`${ZONES}/${KITCHEN.id}/edit`);
    await settle(fixture);
    await settle(fixture);

    expect(find(fixture, 'lib-caution-line')?.textContent).toContain(
      'people.zoneCaution'
    );
  });

  it('offers marking for an active zone and restoring for a marked one', async () => {
    const active = await bootShoppers(`${ZONES}/${KITCHEN.id}`);
    expect(find(active, '[data-action="mark-for-deletion"]')).not.toBeNull();
    expect(find(active, '[data-action="restore-zone"]')).toBeNull();
    expect(find(active, '[data-marked]')).toBeNull();

    const marked = await bootShoppers(`${ZONES}/${ALLOTMENT.id}`);
    expect(find(marked, '[data-action="mark-for-deletion"]')).toBeNull();
    expect(find(marked, '[data-action="restore-zone"]')).not.toBeNull();
    expect(find(marked, '[data-marked]')).not.toBeNull();
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
      find(fixture, 'lib-zone-page lib-page-tabs a .count')?.textContent
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
    expect(find(fixture, '[data-link="change"]')?.getAttribute('href')).toBe(
      `${ZONES}/${KITCHEN.id}/members/${compositeId([
        KITCHEN.id,
        member.membershipId,
      ])}`
    );
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
    find(fixture, '.menu-item[data-action="ban-member"]')?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

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
    // The zone is the address, so the page does not ask for it again.
    expect(textOf(fixture)).not.toContain('people.memberships.zoneIdHelp');

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);
    // "Edit" turns the same page into a form, with the one caution in sight.
    expect(find(fixture, 'lib-field-control')).not.toBeNull();
    expect(find(fixture, 'lib-record-view [data-caution]')).not.toBeNull();
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
  it.each([
    [`${PEOPLE}/nobody`, 'lib-person-page', 'people.users.many'],
    [`${ZONES}/nowhere`, 'lib-zone-page', 'people.zones.many'],
  ])('says so at %s, with no Edit and no tabs', async (url, page, heading) => {
    const fixture = await bootShoppers(url);
    await settle(fixture);

    const header = find(fixture, `${page} lib-page-header`);
    expect(header?.textContent).toContain(heading);
    expect(header?.textContent).not.toContain('resource.form.loading');
    expect(find(fixture, `${page} [data-edit]`)).toBeNull();
    expect(find(fixture, `${page} [data-action]`)).toBeNull();
    expect(find(fixture, `${page} lib-page-tabs a`)).toBeNull();
    expect(find(fixture, `${page} .state.error`)).not.toBeNull();
  });
});

describe('a list of a zone', () => {
  const address = `${ZONES}/${KITCHEN.id}/lists/${WEEKLY.id}`;
  const lineRow = (fixture: ComponentFixture<ShoppersTestHost>, id: string) =>
    find(fixture, `[data-line="${id}"]`) as HTMLElement;
  const pending = WEEKLY.lines.find(
    (line) => line.approvalStatus === 'PENDING'
  );

  /**
   * A list is read by its own id. So an address that names another zone goes
   * to the list's own address, and never draws the list under that zone.
   */
  it('goes to the list own zone when the address names another one', async () => {
    const other = ZONE_SEED.find((zone) => zone.id !== KITCHEN.id);
    expect(other).toBeDefined();

    const fixture = await bootShoppers(
      `${ZONES}/${other?.id}/lists/${WEEKLY.id}`
    );
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(address);
  });

  // The fixture is what makes the specs below mean anything.
  it('has a line that waits in the fixture', () => {
    expect(pending).toBeDefined();
  });

  it('is the one page that shows what a household wrote down', async () => {
    const fixture = await bootShoppers(address);

    expect(find(fixture, 'lib-list-page .page-title')?.textContent).toBe(
      'Weekly shop'
    );
    expect(textOf(fixture)).toContain('Milk, two litres');
    expect(textOf(fixture)).toContain('people.lists.approval.PENDING');
    expect(textOf(fixture)).toContain('people.lists.settings');
  });

  it('goes back to the Lists tab of its zone', async () => {
    const fixture = await bootShoppers(address);

    expect(
      find(fixture, 'lib-list-page .page-back')?.getAttribute('href')
    ).toBe(`${ZONES}/${KITCHEN.id}/lists`);
  });

  it('puts a line that waits on the waiting wash, with both answers', async () => {
    const fixture = await bootShoppers(address);
    const row = lineRow(fixture, pending?.id ?? '');

    expect(row.classList).toContain('waiting');
    expect(
      [...row.querySelectorAll('[data-action]')].map((button) =>
        button.getAttribute('data-action')
      )
    ).toEqual(['approve-line', 'reject-line']);
  });

  /** Target 5: "Approve" and "Reject" are on a line that waits, and on no other. */
  it('offers neither answer on a line that was answered', async () => {
    const fixture = await bootShoppers(address);
    const answered = WEEKLY.lines.filter(
      (line) => line.approvalStatus !== 'PENDING'
    );

    expect(answered.length).toBeGreaterThan(0);
    for (const line of answered) {
      const row = lineRow(fixture, line.id);

      expect(row.classList).not.toContain('waiting');
      expect([...row.querySelectorAll('[data-action]')]).toEqual([]);
      // What every line has is still there.
      expect(row.querySelector('[data-edit-line]')).not.toBeNull();
    }
  });

  it('rejects a line through the service, once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(address, withDirectory(directory));

    lineRow(fixture, pending?.id ?? '')
      .querySelector<HTMLButtonElement>('[data-action="reject-line"]')
      ?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    controlSaying(fixture, 'people.lines.confirm.reject.confirm')?.click();
    await settle(fixture);

    expect(calls).toEqual([`line:${WEEKLY.id}:${pending?.id}:REJECTED`]);
  });

  it('offers edit and delete on every line, and no way to add one', async () => {
    const fixture = await bootShoppers(address);

    expect(findAll(fixture, '[data-edit-line]')).toHaveLength(
      WEEKLY.lines.length
    );
    expect(findAll(fixture, '[data-delete-line]')).toHaveLength(
      WEEKLY.lines.length
    );
    expect(controlSaying(fixture, 'resource.action.create')).toBeUndefined();
  });

  it('opens a line under the list to be read, and goes back to the list', async () => {
    const fixture = await bootShoppers(address);
    const [first] = WEEKLY.lines;
    const form = `${address}/lines/${compositeId([WEEKLY.id, first.id])}`;

    expect(
      lineRow(fixture, first.id)
        .querySelector('[data-edit-line]')
        ?.getAttribute('href')
    ).toBe(form);

    await TestBed.inject(Router).navigateByUrl(form);
    await settle(fixture);
    await settle(fixture);
    expect(find(fixture, 'lib-record-view')).not.toBeNull();
    expect(find(fixture, 'lib-field-control')).toBeNull();

    find<HTMLAnchorElement>(fixture, 'lib-record-page .page-back')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(currentUrl()).toBe(address);
  });

  it('deletes a line once confirmed', async () => {
    const fixture = await bootShoppers(address);
    const [first] = WEEKLY.lines;

    lineRow(fixture, first.id)
      .querySelector<HTMLButtonElement>('[data-delete-line]')
      ?.click();
    await settle(fixture);
    expect(textOf(fixture)).toContain('resource.confirm.delete.heading');

    controlSaying(fixture, 'resource.confirm.delete.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(find(fixture, 'lib-confirm-dialog')).toBeNull();
  });

  it('says who adds a line behind the info button, and the caution in sight', async () => {
    const fixture = await bootShoppers(address);

    expect(find(fixture, 'lib-caution-line')?.textContent).toContain(
      'people.zoneCaution'
    );
    expect(textOf(fixture)).not.toContain('people.lists.info.adds');

    find<HTMLButtonElement>(
      fixture,
      'lib-list-page lib-info-button button'
    )?.click();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('people.lists.info.corrects');
    expect(textOf(fixture)).toContain('people.lists.info.adds');
  });

  it('links Edit list to the form, which goes back to the list', async () => {
    const fixture = await bootShoppers(address);

    expect(
      find(fixture, 'lib-list-page [data-edit]')?.getAttribute('href')
    ).toBe(`${address}/edit`);
  });
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

describe('a shopping list', () => {
  const address = `${PEOPLE}/${ROSA.userId}/shopping-lists/b-saturday`;

  it('shows its rows and what was bought of each', async () => {
    const fixture = await bootShoppers(address);

    expect(textOf(fixture)).toContain('Bread');
    expect(textOf(fixture)).toContain('people.baskets.status.OPEN');
    // The kind is drawn beside it, because an `OPEN` basket that never ends
    // and one nobody finished read the same without it.
    expect(textOf(fixture)).toContain('people.baskets.kind.GENERATED');
    expect(textOf(fixture)).toContain('people.baskets.bought');
  });

  it('goes back to the Shopping lists tab of its owner', async () => {
    const fixture = await bootShoppers(address);

    expect(
      find(fixture, 'lib-basket-page .page-back')?.getAttribute('href')
    ).toBe(`${PEOPLE}/${ROSA.userId}/shopping-lists`);
  });

  it('offers nothing to change, and says why behind the info button', async () => {
    const fixture = await bootShoppers(address);

    expect(textOf(fixture)).not.toContain('resource.action.save');
    expect(textOf(fixture)).not.toContain('resource.action.delete');
    expect(textOf(fixture)).not.toContain('resource.action.edit');

    find<HTMLButtonElement>(
      fixture,
      'lib-basket-page lib-info-button button'
    )?.click();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('people.baskets.info.record');
    expect(textOf(fixture)).toContain('people.baskets.info.correct');
  });
});
