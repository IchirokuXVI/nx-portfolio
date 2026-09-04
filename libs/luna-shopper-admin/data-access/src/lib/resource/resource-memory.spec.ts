import { TestBed } from '@angular/core/testing';
import type { ResourceRow } from '@portfolio/luna-shopper-admin/models';
import { RESOURCE_GATEWAYS } from './resource-gateways';
import { ResourceMemoryGateways } from './resource-memory';

const PATH = '/v1/admin/catalog/supermarkets';

const seed: ResourceRow[] = [
  { id: 'a', name: 'Aldi' },
  { id: 'b', name: 'Bonpreu' },
  { id: 'c', name: 'Consum' },
];

/**
 * The default behind {@link RESOURCE_GATEWAYS}: every resource, out of memory.
 *
 * The workspace rule is that a data domain runs with no backend, and this is how
 * fifteen resources get that without fifteen classes.
 */
describe('ResourceMemoryGateways', () => {
  let gateways: ResourceMemoryGateways;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    gateways = TestBed.inject(ResourceMemoryGateways);
  });

  it('is what the token resolves to with no configuration at all', () => {
    expect(TestBed.inject(RESOURCE_GATEWAYS)).toBeInstanceOf(
      ResourceMemoryGateways
    );
  });

  it('answers the seed', async () => {
    const page = await gateways.for({ path: PATH, seed }).list({});

    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  /**
   * Paginating for real rather than answering everything in one page. A memory
   * gateway that never returned a cursor would let a bug in the list's own
   * paging survive every spec that used it.
   */
  it('paginates, and the cursor leads to the rest', async () => {
    const gateway = gateways.for({ path: PATH, seed, pageSize: 2 });

    const first = await gateway.list({});
    expect(first.items.map((row) => row['id'])).toEqual(['a', 'b']);
    expect(first.nextCursor).not.toBeNull();

    const second = await gateway.list({
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((row) => row['id'])).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
  });

  /**
   * One table per path, held for the life of the injector, which is what lets
   * the whole app be driven with nothing listening: a row created on the form is
   * there when the list redraws.
   */
  it('keeps what was written, across gateways for the same path', async () => {
    await gateways.for({ path: PATH, seed }).create({ name: 'Dia' });

    const page = await gateways.for({ path: PATH, seed }).list({});

    expect(page.items).toHaveLength(4);
    expect(page.items[3]['name']).toBe('Dia');
  });

  it('changes and deletes a row by id', async () => {
    const gateway = gateways.for({ path: PATH, seed });

    await gateway.update('b', { name: 'Bonpreu i Esclat' });
    expect((await gateway.read('b'))['name']).toBe('Bonpreu i Esclat');

    await gateway.remove('b');
    await expect(gateway.read('b')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a row that is not there the way the gateway would', async () => {
    const gateway = gateways.for({ path: PATH, seed });

    await expect(gateway.read('zzz')).rejects.toMatchObject({
      name: 'GatewayError',
      code: 'not_found',
      status: 404,
    });
  });

  it('filters, so the no match state can be reached without a backend', async () => {
    const gateway = gateways.for({ path: PATH, seed });

    const matching = await gateway.list({ filters: { name: 'bon' } });
    expect(matching.items.map((row) => row['id'])).toEqual(['b']);

    const none = await gateway.list({ filters: { name: 'zzz' } });
    expect(none.items).toEqual([]);
  });

  /**
   * `id` for most things and not for all of them: a user is keyed by `userId`
   * and an admin by `adminId`, so a table that assumed `id` would answer 404 for
   * every row it holds.
   */
  it('finds a row by the property the source named', async () => {
    const gateway = gateways.for({
      path: '/v1/admin/users',
      idField: 'userId',
      seed: [{ userId: 'u1', username: 'rosa' }],
    });

    await expect(gateway.read('u1')).resolves.toEqual({
      userId: 'u1',
      username: 'rosa',
    });
  });

  it('mints a new row id under that same property', async () => {
    const gateway = gateways.for({
      path: '/v1/admin/keyed',
      idField: 'userId',
    });

    const created = await gateway.create({ username: 'marc' });

    expect(Object.keys(created)).toContain('userId');
    expect(created['id']).toBeUndefined();
  });

  it('keeps two resources apart', async () => {
    await gateways.for({ path: PATH, seed }).create({ name: 'Dia' });

    const other = await gateways
      .for({ path: '/v1/admin/catalog/items' })
      .list({});

    expect(other.items).toEqual([]);
  });
});

/**
 * One table, two callers, one fixture (plan 0009, section 3.2).
 *
 * A membership is served out of the same table by the descriptor, which names
 * the seed, and by `DirectoryMemory`, which keeps a status change in step with
 * the zone's own membership array and has no seed because the fixture lives a
 * library above it. Whichever asked first used to decide.
 */
describe('ResourceMemoryGateways, when one table has two callers', () => {
  const PATH = '/v1/admin/zones/{zoneId}/members';
  const SEED = [{ id: 'm1', username: 'rosa' }];

  it('seeds the table the first time a seed is offered, not only on creation', async () => {
    const gateways = new ResourceMemoryGateways();

    // The caller with no fixture goes first, which is what happens when
    // somebody kicks a member from the zone screen before ever opening the
    // membership list.
    gateways.for({ path: PATH });
    const seeded = gateways.for({ path: PATH, seed: SEED });

    expect((await seeded.list({})).items).toHaveLength(1);
  });

  /**
   * Once, and tracked apart from the rows: a table an operator emptied by
   * deleting every row must not be quietly refilled the next time a screen asks
   * for it.
   */
  it('does not refill a table that was emptied on purpose', async () => {
    const gateways = new ResourceMemoryGateways();
    const first = gateways.for({ path: PATH, seed: SEED });
    await first.remove('m1');

    const second = gateways.for({ path: PATH, seed: SEED });

    expect((await second.list({})).items).toEqual([]);
  });
});
