import { TestBed } from '@angular/core/testing';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { ResourceMemoryGateways } from '../resource/resource-memory';
import { DirectoryMemory } from './directory-memory';
import { ADMIN_USERS_PATH, ADMIN_ZONES_PATH } from './directory-paths';

const REGISTERED = 'user-registered';
const GUEST = 'user-guest';

/**
 * The roles half of the memory twin (admin plan 0038).
 *
 * It writes the same table the users listing reads, so a grant in this mode
 * shows on the list and the page, and it refuses a guest the way auth does, so
 * the screen that explains that refusal can be driven with no server.
 */
describe('DirectoryMemory, for roles', () => {
  function setUp() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const users = TestBed.inject(ResourceMemoryGateways).for<ResourceRow>({
      path: ADMIN_USERS_PATH,
      idField: 'userId',
      seed: [
        { userId: REGISTERED, kind: 'REGISTERED', roles: [] },
        { userId: GUEST, kind: 'TEMPORARY', roles: [] },
      ],
    });
    // Seed the table before the directory asks for it without one.
    void users.list({});

    return { users, directory: TestBed.inject(DirectoryMemory) };
  }

  it('stores the whole set, each once and in the order the server lists them', async () => {
    const { users, directory } = setUp();

    await directory.setUserRoles(REGISTERED, ['premium', 'admin', 'premium']);

    expect((await users.read(REGISTERED))['roles']).toEqual([
      'admin',
      'premium',
    ]);
  });

  it('takes every role away with an empty set', async () => {
    const { users, directory } = setUp();

    await directory.setUserRoles(REGISTERED, ['admin']);
    await directory.setUserRoles(REGISTERED, []);

    expect((await users.read(REGISTERED))['roles']).toEqual([]);
  });

  it('refuses a guest with the code auth answers', async () => {
    const { users, directory } = setUp();

    const refused = directory.setUserRoles(GUEST, ['admin']);

    await expect(refused).rejects.toBeInstanceOf(GatewayError);
    await expect(refused).rejects.toMatchObject({
      code: 'guest_has_no_roles',
      status: 409,
    });
    expect((await users.read(GUEST))['roles']).toEqual([]);
  });
});

/**
 * The two counts a zone row carries (admin plan 0045, section 2).
 *
 * The gateway counts them on every read. This table keeps what was written, so
 * an action that moves a membership writes the counts with it. Otherwise a
 * zone would go on saying a request waits after it was approved, and the
 * screen driven in this mode would show a state the server never answers.
 */
describe('DirectoryMemory, for the counts of a zone', () => {
  const ZONE = 'zone-1';

  function setUp() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const zones = TestBed.inject(ResourceMemoryGateways).for<ResourceRow>({
      path: ADMIN_ZONES_PATH,
      seed: [
        {
          id: ZONE,
          memberCount: 1,
          pendingCount: 2,
          members: [
            { membershipId: 'm-owner', role: 'OWNER', status: 'APPROVED' },
            { membershipId: 'm-first', role: 'MEMBER', status: 'PENDING' },
            { membershipId: 'm-second', role: 'MEMBER', status: 'PENDING' },
          ],
        },
      ],
    });
    // Seed the table before the directory asks for it without one.
    void zones.list({});

    return { zones, directory: TestBed.inject(DirectoryMemory) };
  }

  it('moves a request to the members when it is approved', async () => {
    const { zones, directory } = setUp();

    await directory.approveMember(ZONE, 'm-first');

    expect(await zones.read(ZONE)).toMatchObject({
      memberCount: 2,
      pendingCount: 1,
    });
  });

  it('takes a request off the count when it is rejected', async () => {
    const { zones, directory } = setUp();

    await directory.rejectMember(ZONE, 'm-first');

    expect(await zones.read(ZONE)).toMatchObject({
      memberCount: 1,
      pendingCount: 1,
    });
  });

  it('counts a banned member as neither', async () => {
    const { zones, directory } = setUp();

    await directory.approveMember(ZONE, 'm-first');
    await directory.banMember(ZONE, 'm-first');

    expect(await zones.read(ZONE)).toMatchObject({
      memberCount: 1,
      pendingCount: 1,
    });
  });
});
