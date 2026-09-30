import { TestBed } from '@angular/core/testing';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';
import { GatewayError } from '../gateway-error';
import { ResourceMemoryGateways } from '../resource/resource-memory';
import { DirectoryMemory } from './directory-memory';
import { ADMIN_USERS_PATH } from './directory-paths';

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
