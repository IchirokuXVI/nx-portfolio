import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { HARVESTER_ENTITIES, PostalCodeDiscoveryRequest } from '../entities';
import { PostalCodeDiscoveryStore } from './postal-code-discovery.store';

/**
 * The discovery queue against real Postgres (plan 0063, sections 3, 4 and 10).
 *
 * Everything interesting about this table lives in SQL rather than in TypeScript
 * and a mocked repository cannot tell you whether it works: the deduplication is
 * a unique constraint because the racing writers are two ordinary profile saves,
 * the cooldown is an `ON CONFLICT ... WHERE` over an interval, and the claim is
 * one `FOR UPDATE SKIP LOCKED` statement so two replicas draining at once cannot
 * take the same row.
 *
 * The cooldown is proven by **moving the clock**, which here means writing
 * `discoveredAt` into the past. Waiting thirty days is not a test.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('postal code discovery queue (real Postgres)', () => {
  /** A country nothing else in this database uses, so cleanup is exact. */
  const COUNTRY = 'zz';
  let dataSource: DataSource;
  let repository: Repository<PostalCodeDiscoveryRequest>;
  let store: PostalCodeDiscoveryStore;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(PostalCodeDiscoveryRequest);
    store = new PostalCodeDiscoveryStore(repository);
  });

  beforeEach(async () => {
    await dataSource.query(
      `DELETE FROM "postal_code_discovery_requests" WHERE "country" = $1`,
      [COUNTRY]
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM "postal_code_discovery_requests" WHERE "country" = $1`,
        [COUNTRY]
      );
      await dataSource.destroy();
    }
  });

  /** Claim the next row, failing the test rather than the type when empty. */
  async function claim(): Promise<PostalCodeDiscoveryRequest> {
    const claimed = await store.claimNext();
    if (!claimed) {
      throw new Error('expected a due row to claim');
    }
    return claimed;
  }

  async function load(postalCode: string) {
    return repository.findOneOrFail({
      where: { country: COUNTRY, postalCode },
    });
  }

  it('has the table and its unique key', async () => {
    const rows = await dataSource.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = '"postal_code_discovery_requests"'::regclass`
    );
    const names = new Set(rows.map((r: { conname: string }) => r.conname));
    expect(names.has('uq_postal_code_discovery_country_code')).toBe(true);
  });

  it('turns two users adding the same code into one row', async () => {
    // The exact case section 3 is about: two profile saves by two people in the
    // same street, and the constraint is what settles it rather than a read.
    const first = await store.enqueue(COUNTRY, '00001', 30);
    const second = await store.enqueue(COUNTRY, '00001', 30);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(
      await repository.count({
        where: { country: COUNTRY, postalCode: '00001' },
      })
    ).toBe(1);
  });

  it('leaves a code discovered five days ago alone', async () => {
    await store.enqueue(COUNTRY, '00002', 30);
    const claimed = await claim();
    await store.markDone(claimed.id, '5efa0000-0000-4000-a000-000000000abc');
    await dataSource.query(
      `UPDATE "postal_code_discovery_requests"
          SET "discoveredAt" = now() - interval '5 days'
        WHERE "country" = $1 AND "postalCode" = '00002'`,
      [COUNTRY]
    );

    expect(await store.enqueue(COUNTRY, '00002', 30)).toBe(false);
    expect((await load('00002')).status).toBe('DONE');
  });

  it('re-asks a code discovered thirty one days ago', async () => {
    await store.enqueue(COUNTRY, '00003', 30);
    const claimed = await claim();
    await store.markDone(claimed.id, '5efa0000-0000-4000-a000-000000000abd');
    await dataSource.query(
      `UPDATE "postal_code_discovery_requests"
          SET "discoveredAt" = now() - interval '31 days'
        WHERE "country" = $1 AND "postalCode" = '00003'`,
      [COUNTRY]
    );

    expect(await store.enqueue(COUNTRY, '00003', 30)).toBe(true);
    const reopened = await load('00003');
    expect(reopened.status).toBe('QUEUED');
    expect(reopened.attempts).toBe(0);
  });

  it('keeps the first request time when a code is re-asked', async () => {
    await store.enqueue(COUNTRY, '00004', 30);
    const original = (await load('00004')).requestedAt;
    const claimed = await claim();
    await store.markDone(claimed.id, '5efa0000-0000-4000-a000-000000000abe');
    await dataSource.query(
      `UPDATE "postal_code_discovery_requests"
          SET "discoveredAt" = now() - interval '31 days'
        WHERE "country" = $1 AND "postalCode" = '00004'`,
      [COUNTRY]
    );
    await store.enqueue(COUNTRY, '00004', 30);

    // The claim orders by it, so moving it would send an old code to the back
    // of the queue every time somebody mentioned it again.
    expect((await load('00004')).requestedAt).toEqual(original);
  });

  it('claims the oldest due row and hands out each row once', async () => {
    await store.enqueue(COUNTRY, '00005', 30);
    await store.enqueue(COUNTRY, '00006', 30);

    const first = await store.claimNext();
    const second = await store.claimNext();
    const third = await store.claimNext();

    expect(first?.postalCode).toBe('00005');
    expect(second?.postalCode).toBe('00006');
    expect(third).toBeNull();
    expect((await load('00005')).status).toBe('RUNNING');
    expect((await load('00005')).attempts).toBe(1);
  });

  it('does not claim a row whose backoff has not elapsed', async () => {
    await store.enqueue(COUNTRY, '00007', 30);
    const claimed = await claim();
    await store.markAttemptFailed(claimed, 'Overpass timed out', 3, null);

    expect(await store.claimNext()).toBeNull();
    const backedOff = await load('00007');
    expect(backedOff.status).toBe('QUEUED');
    expect(backedOff.nextAttemptAt).not.toBeNull();
    expect(backedOff.error).toBe('Overpass timed out');
  });

  it('gives up after the attempt limit and keeps the reason', async () => {
    await store.enqueue(COUNTRY, '00008', 30);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await dataSource.query(
        `UPDATE "postal_code_discovery_requests"
            SET "nextAttemptAt" = NULL
          WHERE "country" = $1 AND "postalCode" = '00008'`,
        [COUNTRY]
      );
      const claimed = await claim();
      await store.markAttemptFailed(
        claimed,
        'Nominatim found no point for postal code 00008',
        3,
        null
      );
    }

    const exhausted = await load('00008');
    expect(exhausted.status).toBe('FAILED');
    expect(exhausted.attempts).toBe(3);
    expect(exhausted.nextAttemptAt).toBeNull();
    expect(exhausted.error).toContain('Nominatim found no point');
    // And it stays out of the queue rather than being picked up again.
    expect(await store.claimNext()).toBeNull();
  });

  it('re-queues a FAILED code once the cooldown has passed', async () => {
    await store.enqueue(COUNTRY, '00009', 30);
    const claimed = await claim();
    await store.markAttemptFailed(claimed, 'the internet was broken', 1, null);
    expect((await load('00009')).status).toBe('FAILED');

    // Inside the cooldown a FAILED code is left where it is, so a bad code
    // cannot be retried by every profile save that mentions it.
    expect(await store.enqueue(COUNTRY, '00009', 30)).toBe(false);

    await dataSource.query(
      `UPDATE "postal_code_discovery_requests"
          SET "lastAttemptedAt" = now() - interval '31 days'
        WHERE "country" = $1 AND "postalCode" = '00009'`,
      [COUNTRY]
    );
    expect(await store.enqueue(COUNTRY, '00009', 30)).toBe(true);
    expect((await load('00009')).error).toBeNull();
  });

  it('requeues a row whose worker died without spending its budget twice', async () => {
    await store.enqueue(COUNTRY, '00010', 30);
    await store.claimNext();
    await dataSource.query(
      `UPDATE "postal_code_discovery_requests"
          SET "lastAttemptedAt" = now() - interval '1 hour'
        WHERE "country" = $1 AND "postalCode" = '00010'`,
      [COUNTRY]
    );

    expect(await store.reapStale(900)).toBe(1);
    const requeued = await load('00010');
    expect(requeued.status).toBe('QUEUED');
    expect(await store.claimNext()).not.toBeNull();
  });
});
