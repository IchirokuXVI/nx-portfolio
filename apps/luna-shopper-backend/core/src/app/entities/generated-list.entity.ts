import {
  GeneratedListStatus,
  type GeneratedListSourceSnapshot,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * The basket a person carries around the shop (plan 0050, section 1), composed
 * from the wanted, approved lines of the zones and lists they chose.
 *
 * ## Why it is not a `ShoppingList` with a `kind` column
 *
 * Section 1 rejects that shortcut on one decisive fact: **a generated list draws
 * from several zones at once**, so it has no `zoneId`. `ShoppingList.zoneId` is
 * non nullable and load bearing in every query, every authorization check, every
 * realtime room and every event payload in plans 0006, 0007 and 0009. Making it
 * nullable would turn "which zone is this list in" from a fact into a question
 * every one of those call sites has to answer.
 *
 * ## The columns that carry rules
 *
 * `ownerUserId` is the only user who may read it (section 8). Not zone admins,
 * not the zone owner, nobody. Plan 0051 widens that to participants on a share
 * link, and the column it will sit beside is this one.
 *
 * `name` is nullable and null is **not** missing: an unnamed basket is displayed
 * as its generation date, localized by the reader's client, so the default is
 * never stored, never needs localizing server side, and never collides.
 *
 * `sourceSnapshot` is not decoration. A run's meaning depends on which lists it
 * drew from and the preferences change underneath it; without the snapshot a
 * three week old basket cannot be explained to the person looking at it.
 *
 * `idempotencyKey` is what stops a double tap producing two baskets (plan 0004,
 * section 9). It is a column here rather than a `ProcessedEvent` row because the
 * second caller needs **the basket the first one made**, and a store that only
 * answers "seen before" could not hand it back.
 */
@Entity({ name: 'generated_lists' })
@Index('ix_generated_lists_owner', ['ownerUserId', 'generatedAt'])
@Index('uq_generated_lists_idempotency', ['ownerUserId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
export class GeneratedList extends BaseEntity {
  /** The only user who may read this basket (plan 0050, section 8). */
  @Column({ type: 'uuid' })
  ownerUserId!: string;

  /** Null means the client renders the generation date instead (section 1). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({
    type: 'enum',
    enum: GeneratedListStatus,
    default: GeneratedListStatus.DRAFT,
  })
  status!: GeneratedListStatus;

  @Column({ type: 'timestamptz' })
  generatedAt!: Date;

  /** The zones, lists and profile the run used, copied at generation time. */
  @Column({ type: 'jsonb' })
  sourceSnapshot!: GeneratedListSourceSnapshot;

  /**
   * The list every `ADDED` line is also written into unless it names its own
   * (section 5): "everything I add today also goes in the flat list".
   *
   * A default on new lines and **never a retroactive sweep** over lines already
   * added, which is the difference between an ergonomic default and an edit
   * nobody asked for.
   */
  @Column({ type: 'uuid', nullable: true })
  defaultTargetListId!: string | null;

  /** Null for a run that carried no key; unique per owner when it did. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  idempotencyKey!: string | null;
}
