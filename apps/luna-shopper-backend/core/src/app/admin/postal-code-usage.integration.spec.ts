import { ProfilePostalCodeSource } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES, ProfilePostalCode } from '../entities';
import { AdminPostalCodeService } from './admin-postal-code.service';
import type { CorePlatformAdminService } from './platform-admin.service';

/**
 * Who is waiting on a postal code, against real Postgres (plan 0097, section 5).
 *
 * The whole answer is one grouped statement with five `FILTER` clauses, and the
 * two mistakes it exists to avoid are invisible to a fake repository: counting
 * profiles where a person was meant, and letting a suppressed row into the
 * number that says who is waiting. Both read correctly and answer wrongly.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:<port>/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration
 */
describeIntegration('postal code usage (real Postgres)', () => {
  /** A country nothing else in this database uses, so cleanup is exact. */
  const COUNTRY = 'zy';
  const ADMIN = { adminToken: 'good' };
  const ONE_PERSON = 'aa970000-0000-4000-a000-000000000001';
  const ANOTHER = 'aa970000-0000-4000-a000-000000000002';

  let dataSource: DataSource;
  let service: AdminPostalCodeService;
  let profileIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    service = new AdminPostalCodeService(
      dataSource.getRepository(ProfilePostalCode),
      { requireAdmin: async () => 'admin-1' } as CorePlatformAdminService
    );
  });

  beforeEach(async () => {
    await clean();
    profileIds = [];
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  async function clean() {
    await dataSource.query(
      `DELETE FROM "shopping_profiles" WHERE "userId" = ANY($1::uuid[])`,
      [[ONE_PERSON, ANOTHER]]
    );
  }

  /** One profile, owned by somebody. The codes cascade with it. */
  async function profile(userId: string): Promise<string> {
    const [created]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO "shopping_profiles" ("userId") VALUES ($1) RETURNING "id"`,
      [userId]
    );
    profileIds.push(created.id);
    return created.id;
  }

  async function code(
    profileId: string,
    postalCode: string,
    source: ProfilePostalCodeSource,
    suppressed = false
  ) {
    await dataSource.query(
      `INSERT INTO "profile_postal_codes"
         ("profileId", "postalCode", "country", "source", "suppressed")
       VALUES ($1, $2, $3, $4, $5)`,
      [profileId, postalCode, COUNTRY, source, suppressed]
    );
  }

  it('counts distinct people, not profiles, for one person with two profiles', async () => {
    const first = await profile(ONE_PERSON);
    const second = await profile(ONE_PERSON);
    await code(first, '00001', ProfilePostalCodeSource.TYPED);
    await code(second, '00001', ProfilePostalCodeSource.DEVICE);

    const { usage } = await service.usage({
      ...ADMIN,
      country: COUNTRY,
      postalCodes: ['00001'],
    });

    // Two profiles want this code and one person does, and both numbers are
    // shown because they answer different questions. A `TYPED` row and a
    // `DEVICE` row are one person even so, which is why the query filters
    // rather than groups by source.
    expect(usage[0].mainProfiles).toBe(2);
    expect(usage[0].mainUsers).toBe(1);
  });

  it('keeps a derived code apart from one somebody typed', async () => {
    const mine = await profile(ONE_PERSON);
    const theirs = await profile(ANOTHER);
    await code(mine, '00002', ProfilePostalCodeSource.TYPED);
    await code(theirs, '00002', ProfilePostalCodeSource.NEARBY);

    const { usage } = await service.usage({
      ...ADMIN,
      country: COUNTRY,
      postalCodes: ['00002'],
    });

    // A code twelve people typed is a place people shop; a code derived onto
    // twelve profiles is a place we widened into, and importing a shop there
    // serves them differently.
    expect(usage[0]).toMatchObject({
      mainProfiles: 1,
      mainUsers: 1,
      nearbyProfiles: 1,
      nearbyUsers: 1,
      suppressedProfiles: 0,
    });
  });

  it('leaves a suppressed row out of the nearby count and reports it', async () => {
    const mine = await profile(ONE_PERSON);
    const theirs = await profile(ANOTHER);
    await code(mine, '00003', ProfilePostalCodeSource.NEARBY, true);
    await code(theirs, '00003', ProfilePostalCodeSource.NEARBY);

    const { usage } = await service.usage({
      ...ADMIN,
      country: COUNTRY,
      postalCodes: ['00003'],
    });

    // Somebody who removed a code we derived is not waiting on it, and is not
    // nothing either: they were offered it and said no.
    expect(usage[0]).toMatchObject({
      nearbyProfiles: 1,
      nearbyUsers: 1,
      suppressedProfiles: 1,
    });
  });

  it('answers zeros for a code nobody uses rather than leaving it out', async () => {
    const mine = await profile(ONE_PERSON);
    await code(mine, '00004', ProfilePostalCodeSource.TYPED);

    const { usage } = await service.usage({
      ...ADMIN,
      country: COUNTRY,
      postalCodes: ['00004', '00005'],
    });

    expect(usage.map((row) => row.postalCode)).toEqual(['00004', '00005']);
    expect(usage[1]).toMatchObject({
      mainProfiles: 0,
      nearbyProfiles: 0,
      suppressedProfiles: 0,
      mainUsers: 0,
      nearbyUsers: 0,
    });
  });

  it('answers a page of codes in the order it was asked', async () => {
    const mine = await profile(ONE_PERSON);
    await code(mine, '00006', ProfilePostalCodeSource.TYPED);
    await code(mine, '00007', ProfilePostalCodeSource.TYPED);

    const { usage } = await service.usage({
      ...ADMIN,
      country: COUNTRY,
      postalCodes: ['00007', '00006'],
    });

    expect(usage.map((row) => row.postalCode)).toEqual(['00007', '00006']);
  });
});
