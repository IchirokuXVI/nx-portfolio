import {
  CategoryInUseException,
  CategoryNotALeafException,
  CategoryNotFoundException,
  CategoryTooDeepException,
  ConflictException,
  ForbiddenException,
  ItemNeedsACategoryException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { QueryFailedError, type Repository } from 'typeorm';
import { categoryId } from '../db/reference/ids';
// `Category` is a value here: the audit double keys on the entity class.
import { Category } from '../entities';
import { fakeAudit } from './catalog-audit.testing';
import {
  asTreeViolation,
  CategoryService,
  checkLeaves,
} from './category.service';
import type { PlatformAdminService } from './platform-admin.service';

const ADMIN = 'owner-1';
const ROOT = 'aaaaaaaa-0000-4000-a000-000000000001';
const CHILD = 'aaaaaaaa-0000-4000-a000-000000000002';
const OTHER_ROOT = 'aaaaaaaa-0000-4000-a000-000000000003';

const row = (id: string, parentId: string | null, slug = id): Category =>
  ({ id, parentId, slug, name: { en: slug }, position: 0 }) as Category;

/**
 * The tree's rules as the service checks them before anything is written
 * (plan 0166, section 1). What the database holds on its own is proven against
 * real Postgres in `category-tree-migration.integration.spec.ts`; this file is
 * the readable half.
 */
function build(
  rows: Category[],
  held: { children?: string[]; products?: string[] } = {}
) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const inserted: Category[] = [];
  const repository = {
    findOne: jest.fn(async ({ where: { id } }: { where: { id: string } }) => {
      const found = byId.get(id);
      return found ? { ...found } : null;
    }),
    count: jest.fn(
      async ({ where: { parentId } }: { where: { parentId: string } }) =>
        rows.filter((r) => r.parentId === parentId).length
    ),
    create: jest.fn((draft: Partial<Category>) => draft as Category),
    save: jest.fn(async (draft: Category) => draft),
    delete: jest.fn(async () => undefined),
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('"held"')) {
        const id = params[0] as string;
        const children = held.children?.includes(id) ?? false;
        const products = held.products?.includes(id) ?? false;
        // The delete asks about both, a move to the top only about products.
        return [
          {
            held: sql.includes('"parentId" = $1')
              ? children || products
              : products,
          },
        ];
      }
      if (sql.includes('"next"')) {
        return [{ next: 5 }];
      }
      return [];
    }),
  };
  const admin = {
    requireAdmin: jest.fn(async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return { kind: 'admin', actorId: credential.userId };
    }),
  } as unknown as PlatformAdminService;
  const audit = fakeAudit([
    [
      Category,
      {
        name: 'categories',
        repository: {
          ...repository,
          insert: async (draft: Category) => {
            inserted.push(draft);
          },
        } as never,
      },
    ],
  ]);
  // The double's manager has no `insert`, so give it one that records.
  const write = audit.service.write.bind(audit.service);
  audit.service.write = (async (actor, work) =>
    write(actor, (tx) => {
      (tx.manager as unknown as { insert: unknown }).insert = async (
        _target: unknown,
        draft: Category
      ) => {
        inserted.push(draft);
      };
      return work(tx);
    })) as typeof audit.service.write;
  const service = new CategoryService(
    repository as unknown as Repository<Category>,
    admin,
    audit.service
  );
  return { service, repository, inserted, audit };
}

describe('checkLeaves', () => {
  const known = new Map([
    [CHILD, row(CHILD, ROOT)],
    [ROOT, row(ROOT, null)],
  ]);

  it('keeps the order meant and drops a repeat', () => {
    const other = row('leaf-2', ROOT);
    const leaves = checkLeaves(
      ['leaf-2', CHILD, 'leaf-2'],
      new Map([...known, ['leaf-2', other]])
    );
    expect(leaves.map((leaf) => leaf.id)).toEqual(['leaf-2', CHILD]);
  });

  it('refuses an empty list (R3)', () => {
    expect(() => checkLeaves([], known)).toThrow(ItemNeedsACategoryException);
  });

  it('names every id that matched nothing', () => {
    try {
      checkLeaves([CHILD, 'x', 'y'], known);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(CategoryNotFoundException);
      expect((error as CategoryNotFoundException).details).toEqual({
        unknown: ['x', 'y'],
      });
    }
  });

  it('refuses a root and names it (R2)', () => {
    try {
      checkLeaves([CHILD, ROOT], known);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(CategoryNotALeafException);
      expect((error as CategoryNotALeafException).details).toEqual({
        categoryId: ROOT,
      });
    }
  });
});

describe('CategoryService', () => {
  it('gates every write to the platform admin', async () => {
    const { service, inserted } = build([row(ROOT, null)]);
    await expect(
      service.create({ userId: 'intruder', slug: 'x', name: { en: 'X' } })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(inserted).toEqual([]);
  });

  it('creates under the id its slug derives, appended after its siblings', async () => {
    const { service, inserted } = build([row(ROOT, null)]);
    const created = await service.create({
      userId: ADMIN,
      parentId: ROOT,
      slug: 'birds',
      name: { en: 'Birds' },
    });
    expect(created).toMatchObject({
      id: categoryId('birds'),
      parentId: ROOT,
      position: 5,
      itemCount: 0,
    });
    expect(inserted).toHaveLength(1);
  });

  it('refuses a slug that is not ascii kebab case, and a name in no language', async () => {
    const { service } = build([]);
    for (const slug of [
      'Birds',
      'bírds',
      'two--dashes',
      '-lead',
      'a'.repeat(81),
    ]) {
      await expect(
        service.create({ userId: ADMIN, slug, name: { en: 'X' } })
      ).rejects.toBeInstanceOf(ValidationException);
    }
    await expect(
      service.create({ userId: ADMIN, slug: 'fine', name: { en: ' ' } })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('R1: refuses a child of a child, naming the parent', async () => {
    const { service, inserted } = build([row(ROOT, null), row(CHILD, ROOT)]);
    await expect(
      service.create({
        userId: ADMIN,
        parentId: CHILD,
        slug: 'deep',
        name: { en: 'Deep' },
      })
    ).rejects.toMatchObject({ details: { categoryId: CHILD } });
    await expect(
      service.create({
        userId: ADMIN,
        parentId: CHILD,
        slug: 'deep',
        name: { en: 'Deep' },
      })
    ).rejects.toBeInstanceOf(CategoryTooDeepException);
    expect(inserted).toEqual([]);
  });

  it('R1: refuses a parent for a root with children, and a parent of itself', async () => {
    const { service } = build([
      row(ROOT, null),
      row(CHILD, ROOT),
      row(OTHER_ROOT, null),
    ]);
    await expect(
      service.update({ userId: ADMIN, categoryId: ROOT, parentId: OTHER_ROOT })
    ).rejects.toMatchObject({ details: { categoryId: ROOT } });
    await expect(
      service.update({
        userId: ADMIN,
        categoryId: OTHER_ROOT,
        parentId: OTHER_ROOT,
      })
    ).rejects.toBeInstanceOf(CategoryTooDeepException);
  });

  it('R2: refuses making a root of a leaf that holds products', async () => {
    const { service } = build([row(ROOT, null), row(CHILD, ROOT)], {
      products: [CHILD],
    });
    await expect(
      service.update({ userId: ADMIN, categoryId: CHILD, parentId: null })
    ).rejects.toBeInstanceOf(CategoryNotALeafException);
  });

  it('moves a leaf to another root and appends it there', async () => {
    const { service } = build([
      row(ROOT, null),
      row(CHILD, ROOT),
      row(OTHER_ROOT, null),
    ]);
    const moved = await service.update({
      userId: ADMIN,
      categoryId: CHILD,
      parentId: OTHER_ROOT,
    });
    expect(moved).toMatchObject({ parentId: OTHER_ROOT, position: 5 });
  });

  it('R4: refuses deleting a category with children or products', async () => {
    const { service, repository } = build([row(ROOT, null), row(CHILD, ROOT)], {
      children: [ROOT],
      products: [CHILD],
    });
    await expect(
      service.delete({ userId: ADMIN, categoryId: ROOT })
    ).rejects.toBeInstanceOf(CategoryInUseException);
    await expect(
      service.delete({ userId: ADMIN, categoryId: CHILD })
    ).rejects.toBeInstanceOf(CategoryInUseException);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('answers an unknown or malformed id with category_not_found', async () => {
    const { service } = build([]);
    await expect(
      service.get({ userId: ADMIN, categoryId: 'not-a-uuid' })
    ).rejects.toBeInstanceOf(CategoryNotFoundException);
    await expect(
      service.get({ userId: ADMIN, categoryId: ROOT })
    ).rejects.toMatchObject({ details: { unknown: [ROOT] } });
  });
});

describe('asTreeViolation', () => {
  const failure = (driverError: Record<string, string>) => {
    const error = new QueryFailedError('SQL', [], new Error('x'));
    (error as unknown as { driverError: unknown }).driverError = driverError;
    return error;
  };

  it('names the rule a trigger refused, and the row it refused', () => {
    const deep = asTreeViolation(
      failure({
        code: '23514',
        constraint: 'ck_categories_two_levels',
        detail: CHILD,
      })
    );
    expect(deep).toBeInstanceOf(CategoryTooDeepException);
    expect((deep as CategoryTooDeepException).details).toEqual({
      categoryId: CHILD,
    });
    expect(
      asTreeViolation(
        failure({
          code: '23514',
          constraint: 'ck_item_categories_leaf',
          detail: ROOT,
        })
      )
    ).toBeInstanceOf(CategoryNotALeafException);
  });

  it('tells a delete refused by a foreign key from an insert naming nothing', () => {
    expect(
      asTreeViolation(
        failure({
          code: '23503',
          constraint: 'fk_item_categories_category',
          detail:
            'Key (id)=(x) is still referenced from table "item_categories".',
        })
      )
    ).toBeInstanceOf(CategoryInUseException);
    expect(
      asTreeViolation(
        failure({
          code: '23503',
          constraint: 'fk_item_categories_category',
          detail: 'Key (categoryId)=(x) is not present in table "categories".',
        })
      )
    ).toBeInstanceOf(CategoryNotFoundException);
  });

  it('answers a taken slug with a conflict and leaves anything else alone', () => {
    expect(
      asTreeViolation(
        failure({ code: '23505', constraint: 'uq_categories_slug' })
      )
    ).toBeInstanceOf(ConflictException);
    const other = failure({ code: '23505', constraint: 'uq_items_ean' });
    expect(asTreeViolation(other)).toBe(other);
    const plain = new Error('boom');
    expect(asTreeViolation(plain)).toBe(plain);
  });
});
