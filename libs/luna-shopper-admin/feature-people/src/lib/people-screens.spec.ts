import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DeploymentStore,
  DIRECTORY_SERVICE,
  ServerReachability,
  SessionStorage,
  SessionStore,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  adminRoutes,
  provideResources,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMINS } from './admins';
import { BASKETS } from './baskets';
import { LISTS } from './lists';
import { USER_SEED, ZONE_SEED } from './people-seed';
import { USERS } from './users';
import { ZONES } from './zones';

/**
 * The people screens, rendered (plan 0007, section 6).
 *
 * Everything here runs against the in-memory gateway, which is the default
 * behind `RESOURCE_GATEWAYS`, so there is no backend and no `HttpClient` in this
 * file. The one thing that is replaced is the directory service, because these
 * specs are about whether an action was *asked for* and *called*, and the
 * in-memory one would answer without recording it.
 *
 * Assertions are on keys rather than on sentences wherever a string is
 * interpolated: the testing translator does not interpolate.
 */

@Component({
  selector: 'lib-test-host',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class TestHost {}

const ALL = [USERS, ZONES, LISTS, BASKETS, ADMINS];

/** A directory that records what it was asked to do and does nothing else. */
function recordingDirectory() {
  const calls: string[] = [];
  const directory: DirectoryServiceI = {
    deleteUser: async (id) => void calls.push(`deleteUser:${id}`),
    resendVerification: async (id) => void calls.push(`resend:${id}`),
    deleteZone: async (id) => void calls.push(`deleteZone:${id}`),
    regenerateJoinCode: async (id) => {
      calls.push(`joinCode:${id}`);
      return 'NEWC0DE1';
    },
    transferOwnership: async (zone, membership) =>
      void calls.push(`transfer:${zone}:${membership}`),
    kickMember: async (zone, membership) =>
      void calls.push(`kick:${zone}:${membership}`),
    banMember: async (zone, membership) =>
      void calls.push(`ban:${zone}:${membership}`),
  };

  return { calls, directory };
}

async function boot(url: string, directory?: DirectoryServiceI) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [TestHost, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter(adminRoutes(ALL)),
      provideLocationMocks(),
      provideResources(...ALL),
      SessionStorage,
      SessionStore,
      DeploymentStore,
      ...(directory === undefined
        ? []
        : [{ provide: DIRECTORY_SERVICE, useValue: directory }]),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(TestHost);
  fixture.detectChanges();

  await TestBed.inject(Router).navigateByUrl(url);
  await settle(fixture);

  return fixture;
}

/**
 * Lets a read settle, then redraws.
 *
 * A macrotask rather than a handful of `Promise.resolve()`s, because a read goes
 * through several awaits and counting them would make this spec depend on how
 * many. `whenStable` is not an option in a zoneless spec: it hangs.
 */
async function settle(fixture: ComponentFixture<TestHost>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const text = (fixture: ComponentFixture<TestHost>) =>
  fixture.nativeElement.textContent as string;

const buttonSaying = (
  fixture: ComponentFixture<TestHost>,
  label: string
): HTMLButtonElement | undefined =>
  [...fixture.nativeElement.querySelectorAll('button')].find(
    (button) => (button as HTMLButtonElement).textContent?.trim() === label
  ) as HTMLButtonElement | undefined;

describe('the users list', () => {
  it('draws one row per account, including two with the same username', async () => {
    const fixture = await boot('/users');

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(USER_SEED.length);

    const handles = [...rows].map((row) =>
      (row as HTMLElement).querySelector('.title')?.textContent?.trim()
    );
    expect(handles.filter((handle) => handle === 'rosa')).toHaveLength(2);
  });

  /**
   * `displayName` is a real full name where an identity provider supplied one.
   * It is on the detail screen and not in a list anybody might screenshot.
   */
  it('shows no display name anywhere on the listing', async () => {
    const fixture = await boot('/users');

    expect(text(fixture)).not.toContain('Rosa Iglesias');
    expect(text(fixture)).not.toContain('Marc Oliver');
  });

  /** Every action is confirmed, and nothing happens until the operator says yes. */
  it('asks before it deletes an account, and names whose', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await boot('/users', directory);

    buttonSaying(fixture, 'people.users.action.deleteAccount')?.click();
    await settle(fixture);

    expect(text(fixture)).toContain(
      'people.users.confirm.deleteAccount.heading'
    );
    expect(calls).toEqual([]);

    buttonSaying(
      fixture,
      'people.users.confirm.deleteAccount.confirm'
    )?.click();
    await settle(fixture);

    expect(calls).toEqual([`deleteUser:${USER_SEED[0].userId}`]);
  });

  it('leaves the account alone when the confirmation is dismissed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await boot('/users', directory);

    buttonSaying(fixture, 'people.users.action.deleteAccount')?.click();
    await settle(fixture);
    buttonSaying(fixture, 'resource.action.cancel')?.click();
    await settle(fixture);

    expect(calls).toEqual([]);
    expect(text(fixture)).not.toContain(
      'people.users.confirm.deleteAccount.heading'
    );
  });
});

describe('the user detail screen', () => {
  it('shows the display name here, where a list would not', async () => {
    const fixture = await boot(`/users/${USER_SEED[0].userId}`);

    expect(text(fixture)).toContain('Rosa Iglesias');
    expect(text(fixture)).toContain('rosa@example.com');
  });

  /**
   * Users are in auth's database and zones are in core's. The zones here are a
   * second query by the same `userId` filter the zones screen offers, not a join.
   */
  it('lists the zones this person is in', async () => {
    const fixture = await boot(`/users/${USER_SEED[0].userId}`);

    expect(text(fixture)).toContain('Kitchen');
  });

  it('offers no resend for an address that is already confirmed', async () => {
    const fixture = await boot(`/users/${USER_SEED[0].userId}`);

    expect(
      buttonSaying(fixture, 'people.users.action.resendVerification')
    ).toBeUndefined();
  });

  it('offers a resend for an address that is not', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await boot(`/users/${USER_SEED[1].userId}`, directory);

    buttonSaying(fixture, 'people.users.action.resendVerification')?.click();
    await settle(fixture);
    buttonSaying(
      fixture,
      'people.users.confirm.resendVerification.confirm'
    )?.click();
    await settle(fixture);

    expect(calls).toEqual([`resend:${USER_SEED[1].userId}`]);
  });
});

describe('the zones list', () => {
  /**
   * Plan 0074, section 3: a listing never fails because a decoration failed, and
   * an owner id that resolved to nobody is drawn as the id.
   */
  it('renders every zone, including one whose owner did not resolve', async () => {
    const fixture = await boot('/zones');

    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(
      ZONE_SEED.length
    );
    expect(text(fixture)).toContain('rosa');
    expect(text(fixture)).toContain(ZONE_SEED[1].ownerUserId);
  });
});

describe('the zone detail screen', () => {
  it('shows the membership with roles and states', async () => {
    const fixture = await boot(`/zones/${ZONE_SEED[0].id}`);

    expect(text(fixture)).toContain('marc');
    expect(text(fixture)).toContain('people.zones.role.OWNER');
    expect(text(fixture)).toContain('people.zones.membership.PENDING');
  });

  /** Names and counts. Not lines: reading those is a click on the list itself. */
  it('shows the zone lists by name and count, and no line contents', async () => {
    const fixture = await boot(`/zones/${ZONE_SEED[0].id}`);

    expect(text(fixture)).toContain('Weekly shop');
    expect(text(fixture)).not.toContain('Milk, two litres');
  });

  it('bans a member through the service, once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await boot(`/zones/${ZONE_SEED[0].id}`, directory);

    buttonSaying(fixture, 'people.zones.action.banMember')?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    buttonSaying(fixture, 'people.zones.confirm.banMember.confirm')?.click();
    await settle(fixture);

    const [zone] = ZONE_SEED;
    expect(calls).toEqual([`ban:${zone.id}:${zone.members[1].membershipId}`]);
  });

  /**
   * Core refuses to kick or ban the owner. An owner leaves by handing the zone
   * on first, which is the action beside those two.
   */
  it('offers no kick or ban against the owner', async () => {
    const fixture = await boot(`/zones/${ZONE_SEED[0].id}`);

    const rows = [...fixture.nativeElement.querySelectorAll('.rows li')];
    const ownerRow = rows.find((row) =>
      (row as HTMLElement).textContent?.includes('people.zones.role.OWNER')
    ) as HTMLElement;

    expect(ownerRow.textContent).not.toContain('people.zones.action.banMember');
    expect(ownerRow.textContent).not.toContain(
      'people.zones.action.transferOwnership'
    );
  });
});

describe('the list detail screen', () => {
  it('is the one screen that shows a household lines', async () => {
    const fixture = await boot('/lists/l-kitchen-weekly');

    expect(text(fixture)).toContain('Milk, two litres');
    expect(text(fixture)).toContain('people.lists.approval.PENDING');
  });

  it('offers nothing to change', async () => {
    const fixture = await boot('/lists/l-kitchen-weekly');

    expect(text(fixture)).not.toContain('resource.action.save');
    expect(text(fixture)).not.toContain('resource.action.delete');
  });
});

describe('the shopping list detail screen', () => {
  it('shows the basket lines', async () => {
    const fixture = await boot('/shopping-lists/b-saturday');

    expect(text(fixture)).toContain('Bread');
    expect(text(fixture)).toContain('people.baskets.status.DRAFT');
  });
});

describe('the admins table', () => {
  /**
   * Plan 0071, section 6: an admin can be seen and cannot be created, edited or
   * deleted from here, ever.
   */
  it('offers no create, edit or delete control', async () => {
    const fixture = await boot('/admins');

    expect(buttonSaying(fixture, 'resource.action.create')).toBeUndefined();
    expect(buttonSaying(fixture, 'resource.action.delete')).toBeUndefined();
    expect(fixture.nativeElement.querySelectorAll('button.title')).toHaveLength(
      0
    );
  });

  it('says in place how an admin is managed instead', async () => {
    const fixture = await boot('/admins');

    expect(text(fixture)).toContain('people.admins.note');
  });

  it('answers the detail address with the not found page', async () => {
    const fixture = await boot('/admins/admin-ichiroku');

    expect(text(fixture)).toContain('notFound.heading');
  });
});
