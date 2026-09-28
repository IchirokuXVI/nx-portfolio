import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One row of the category tree (plan 0166, section 1): a root, or a child of a
 * root, and never deeper.
 *
 * **A leaf is a row with a parent**, not a row without children. A product
 * attaches only to a leaf, so a fresh root with no children yet is still no
 * place for one.
 *
 * The two level rule is enforced twice, in `CategoryService` with a readable
 * code and by the triggers the migration installs, because the seed, the
 * migration and any later writer reach this table too: `parentId` may only name
 * a root, and a row with children may not be given a parent.
 *
 * The id of a seeded row is derived from its slug (`categoryId` in
 * `db/reference/ids.ts`), and so is the id of a row the back office creates, so
 * a slug later added to the taxonomy file lands on the row that already holds
 * it rather than beside it.
 */
@Entity({ name: 'categories' })
export class Category extends BaseEntity {
  /** The root this row sits under, or null for a root. */
  @Column({ type: 'uuid', nullable: true })
  parentId!: string | null;

  /** Ascii kebab case, unique across the whole tree, and never renamed. */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  /** Order among siblings, from 0. A new row appends. */
  @Column({ type: 'int' })
  position!: number;
}
