import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type {
  PostalCodePoint,
  Supermarket,
  SupermarketLocation,
} from '../entities';
import { PlatformAdminService } from './platform-admin.service';
import { PostalCodeService } from './postal-code.service';
import type { PriceScopeService } from './price-scope.service';
import { SupermarketLocationService } from './supermarket-location.service';

const CALLER = 'user-1';
const CHAIN = 'chain-mercadona';

const NORTH = 'shop-north';
const SOUTH = 'shop-south';
const WEST = 'shop-west';

/**
 * A query builder that answers rather than merely records.
 *
 * The two clauses `list` can add are interpreted over an array, so a test can
 * assert on the shops that came back instead of on the SQL that would have
 * fetched them. Narrow on purpose: it understands exactly the clauses the
 * service emits, and a third one would have to be added here deliberately rather
 * than silently passing.
 */
function queryBuilder(rows: SupermarketLocation[]) {
  const clauses: string[] = [];
  let matching = rows;

  const qb = {
    clauses,
    where: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    take: jest.fn(() => qb),
    andWhere: jest.fn((sql: string, params: Record<string, unknown>) => {
      clauses.push(sql);
      if (sql.includes('NOT IN')) {
        const refused = params['refused'] as string[];
        matching = matching.filter((row) => !refused.includes(row.id));
      }
      if (sql.includes('"priceScopeId"')) {
        matching = matching.filter(
          (row) => row.priceScopeId === params['scope']
        );
      }
      return qb;
    }),
    getMany: jest.fn(async () => matching),
  };
  return qb;
}

function build(rows: Partial<SupermarketLocation>[]) {
  const stored = rows.map(
    (row) =>
      ({
        supermarketId: CHAIN,
        priceScopeId: 'scope-1',
        createdAt: new Date(2026, 0, 1),
        ...row,
      }) as SupermarketLocation
  );
  const qb = queryBuilder(stored);

  const locations = {
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as Repository<SupermarketLocation>;

  const config = {
    getOrThrow: () => ({
      platformAdminUserIds: [],
      postalCodeDeriveMaxMetres: 5_000,
    }),
  } as unknown as ConfigService;

  const service = new SupermarketLocationService(
    locations,
    {} as unknown as Repository<Supermarket>,
    {} as unknown as PriceScopeService,
    new PlatformAdminService(config),
    new PostalCodeService({
      find: jest.fn(async () => []),
    } as unknown as Repository<PostalCodePoint>),
    config
  );

  return { service, qb };
}

const idsOf = (page: { items: { id: string }[] }) =>
  page.items.map((item) => item.id);

/**
 * A shop the caller refused is not offered (plan 0064, section 3).
 *
 * The exclusions live in core and the shops live in catalog, so this read is
 * handed the ids rather than working them out. What is proved here is what the
 * read does with them; that the gateway supplies the right ones is proved where
 * the gateway resolves them.
 */
describe('SupermarketLocationService refusals', () => {
  const THREE_SHOPS = [{ id: NORTH }, { id: SOUTH }, { id: WEST }];

  it('leaves out the shops the caller refused', async () => {
    const { service } = build(THREE_SHOPS);

    const page = await service.list({
      userId: CALLER,
      supermarketId: CHAIN,
      excludedSupermarketLocationIds: [NORTH, WEST],
    });

    expect(idsOf(page)).toEqual([SOUTH]);
  });

  it('lists every shop when the caller refused none', async () => {
    const { service, qb } = build(THREE_SHOPS);

    const page = await service.list({
      userId: CALLER,
      supermarketId: CHAIN,
      excludedSupermarketLocationIds: [],
    });

    expect(idsOf(page)).toEqual([NORTH, SOUTH, WEST]);
    // An empty list is not a filter: `NOT IN ()` is not valid SQL, and refusing
    // nothing is the ordinary case rather than an edge one.
    expect(qb.clauses.some((sql) => sql.includes('NOT IN'))).toBe(false);
  });

  it('lists every shop when the request says nothing about refusals', async () => {
    const { service, qb } = build(THREE_SHOPS);

    // What the screen that *edits* the refusals asks for: it has to draw a shop
    // that is switched off, and a read that hid it could not switch it back on.
    const page = await service.list({ userId: CALLER, supermarketId: CHAIN });

    expect(idsOf(page)).toEqual([NORTH, SOUTH, WEST]);
    expect(qb.clauses.some((sql) => sql.includes('NOT IN'))).toBe(false);
  });

  it('offers a shop that arrived after the caller made their choices', async () => {
    const NEWCOMER = 'shop-opened-last-week';
    const { service } = build([...THREE_SHOPS, { id: NEWCOMER }]);

    const page = await service.list({
      userId: CALLER,
      supermarketId: CHAIN,
      excludedSupermarketLocationIds: [NORTH, SOUTH, WEST],
    });

    // A blacklist has never heard of it, so it is included by default. An
    // allowlist would have left it silently missing until somebody noticed,
    // which is the failure nobody can detect (plan 0064, section 1).
    expect(idsOf(page)).toEqual([NEWCOMER]);
  });

  it('narrows by scope and by refusal together', async () => {
    const { service } = build([
      { id: NORTH, priceScopeId: 'scope-a' },
      { id: SOUTH, priceScopeId: 'scope-a' },
      { id: WEST, priceScopeId: 'scope-b' },
    ]);

    const page = await service.list({
      userId: CALLER,
      supermarketId: CHAIN,
      priceScopeId: 'scope-a',
      excludedSupermarketLocationIds: [NORTH],
    });

    expect(idsOf(page)).toEqual([SOUTH]);
  });
});
