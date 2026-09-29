import {
  SHOP_WALK_ENTRY_KINDS,
  type ShopMapDocument,
  type ShopWalkEntryKind,
  type ShopWalkEvent,
  type ShopWalkStopReason,
} from '@portfolio/luna-shopper/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A `bigint` column read back as a number. Log milliseconds fit a double many
 * times over, and `pg` answers a `bigint` as a string.
 */
const bigintAsNumber = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * One walk of a shop (backend plan 0168, section 1): a name, whether shoppers
 * see it, and the document its log folds to.
 *
 * `document` is always the fold of every entry up to `lastSeq`, normalized and
 * valid, rewritten in the same transaction that appends an entry. At most one
 * walk per shop is shown and not deleted, which a partial unique index holds.
 * Deleting sets `deletedAt` and keeps every entry.
 *
 * Written only through `ShopWalkService`.
 */
@Entity({ name: 'shop_walks' })
export class ShopWalk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'uuid' })
  supermarketLocationId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'boolean', default: false })
  shown!: boolean;

  @Column({ type: 'int', default: 0 })
  lastSeq!: number;

  @Column({ type: 'jsonb' })
  document!: ShopMapDocument;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

/**
 * One entry of a walk's log (plan 0168, section 1). The id is the client's, so
 * a retried save is the same row. Nothing updates or deletes a row.
 *
 * `snapshot` is the fold after this entry, stored on every twentieth entry and
 * on every rewind, so a fold that must replay the log starts from one.
 */
@Entity({ name: 'shop_walk_entries' })
export class ShopWalkEntry {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid' })
  walkId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({
    type: 'enum',
    enum: SHOP_WALK_ENTRY_KINDS,
    enumName: 'shop_walk_entry_kind',
  })
  kind!: ShopWalkEntryKind;

  @Column({ type: 'timestamptz' })
  at!: Date;

  @Column({ type: 'bigint', transformer: bigintAsNumber })
  logFrom!: number;

  @Column({ type: 'bigint', transformer: bigintAsNumber })
  logTo!: number;

  @Column({ type: 'jsonb' })
  events!: ShopWalkEvent[];

  @Column({ type: 'bigint', nullable: true, transformer: bigintAsNumber })
  rewoundTo!: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reason!: ShopWalkStopReason | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot!: ShopMapDocument | null;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
