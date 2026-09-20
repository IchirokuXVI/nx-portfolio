import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { GeneratedList } from './generated-list.entity';
import { ShoppingList } from './shopping-list.entity';
import { Zone } from './zone.entity';

/**
 * One source a basket draws from, as the run was asked for it (plan 0133,
 * section 4).
 *
 * It replaces the `sourceSnapshot` column, and the replacement is a table rather
 * than a better shaped blob because of the question a blob cannot answer: **which
 * baskets cover this list**. Plan 0139 asks it on every line write, and no index
 * over a `jsonb` array of pairs makes that a lookup.
 *
 * It does not extend `BaseEntity`, on the same reasoning as
 * `GeneratedListLineOrigin`: a source is written once with its basket and never
 * edited, so it has no life of its own to audit.
 *
 * ## Why it carries foreign keys where the origins carry none
 *
 * The two record different things. An origin is **history** and must outlive what
 * it names, so a zone line deleted underneath a basket leaves the provenance row
 * standing. A source is a **rule that is evaluated today**, and a rule about a
 * list that no longer exists says nothing, so it goes with the list.
 *
 * ## Two rules no constraint can hold
 *
 * - A `LIVE` basket has no source rows at all. Its coverage is every list its
 *   owner can write, which is not a list of sources.
 * - A basket never holds a whole zone row **and** a list row of that same zone.
 *   The whole zone row wins and the list rows are not written.
 *
 * Both are held by the run and pinned by specs.
 */
@Entity({ name: 'basket_sources' })
@Index('uq_basket_sources_zone', ['basketId', 'zoneId'], {
  unique: true,
  where: '"listId" IS NULL',
})
@Index('uq_basket_sources_list', ['basketId', 'listId'], {
  unique: true,
  where: '"listId" IS NOT NULL',
})
@Index('ix_basket_sources_list', ['listId'], { where: '"listId" IS NOT NULL' })
@Index('ix_basket_sources_zone', ['zoneId'], { where: '"listId" IS NULL' })
@Index('ix_basket_sources_basket', ['basketId'])
export class BasketSource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid' })
  basketId!: string;

  @ManyToOne(() => GeneratedList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'basketId' })
  basket!: GeneratedList;

  @Column({ type: 'uuid' })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone!: Zone;

  /** Null means every list of the zone the owner can write (section 4.1). */
  @Column({ type: 'uuid', nullable: true })
  listId!: string | null;

  @ManyToOne(() => ShoppingList, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'listId' })
  list!: ShoppingList | null;
}
