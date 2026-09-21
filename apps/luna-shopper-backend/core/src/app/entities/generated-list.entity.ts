import {
  BasketKind,
  GeneratedListStatus,
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
 * `kind` says what the row is (plan 0133, section 2). A `GENERATED` basket is a
 * trip: it claims lines, the sweep finishes it, and it is in the history. A
 * `LIVE` one is the permanent basket of plan 0136, one per person, unnamed and
 * never finished, and every "is somebody still shopping this" query asks for a
 * `GENERATED` row so that it is not swept up by them.
 *
 * `ownerUserId` is the only user who may read it (section 8). Not zone admins,
 * not the zone owner, nobody. Plan 0051 widens that to participants on a share
 * link, and the column it will sit beside is this one. It is also what
 * `uq_generated_lists_live_owner` makes unique among `LIVE` rows, which is how
 * "one permanent basket a person" is a fact of the database rather than a
 * convention of the service.
 *
 * `name` is nullable and null is **not** missing: an unnamed basket is displayed
 * as its generation date, localized by the reader's client, so the default is
 * never stored, never needs localizing server side, and never collides.
 *
 * What a run drew from lives in `basket_sources` rather than in a column here
 * (plan 0133, section 4), and the rows record the sources **as they were named**
 * rather than the lists they resolved to. A whole zone stays a whole zone, so it
 * follows a list added to that zone next month, and "which baskets cover this
 * list" becomes an index lookup instead of a scan over a `jsonb` blob.
 *
 * `idempotencyKey` is what stops a double tap producing two baskets (plan 0004,
 * section 9). It is a column here rather than a `ProcessedEvent` row because the
 * second caller needs **the basket the first one made**, and a store that only
 * answers "seen before" could not hand it back.
 */
@Entity({ name: 'generated_lists' })
@Index('ix_generated_lists_owner', ['ownerUserId', 'generatedAt'])
// The open baskets of one owner (plan 0139, section 2). The index above orders
// by date and serves the owner's listing, which is every status; this one serves
// the coverage probe, which wants the handful that are still open and drags no
// finished basket through a filter to find them.
@Index('ix_generated_lists_owner_open', ['ownerUserId'], {
  where: `"status" = 'OPEN'`,
})
@Index('uq_generated_lists_live_owner', ['ownerUserId'], {
  unique: true,
  where: `"kind" = 'LIVE'`,
})
@Index('uq_generated_lists_idempotency', ['ownerUserId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotencyKey" IS NOT NULL',
})
export class GeneratedList extends BaseEntity {
  /** The only user who may read this basket (plan 0050, section 8). */
  @Column({ type: 'uuid' })
  ownerUserId!: string;

  /**
   * What this basket is (plan 0133, section 2).
   *
   * No default, so an insert that forgets it fails rather than quietly composing
   * a trip nobody meant to make.
   *
   * `ck_generated_lists_live_shape` holds the rest of what a `LIVE` row is: no
   * name, `OPEN`, and no idempotency key, because no run composed it. Like every
   * other check constraint in core it lives in the migration alone, and
   * {@link GeneratedListService} refuses each of those writes with a message
   * before the constraint has to.
   */
  @Column({ type: 'enum', enum: BasketKind, enumName: 'basket_kind' })
  kind!: BasketKind;

  /** Null means the client renders the generation date instead (section 1). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  name!: string | null;

  @Column({
    type: 'enum',
    enum: GeneratedListStatus,
    enumName: 'basket_status',
    default: GeneratedListStatus.OPEN,
  })
  status!: GeneratedListStatus;

  @Column({ type: 'timestamptz' })
  generatedAt!: Date;

  /**
   * The profile the basket is priced against (plan 0078, section 3), moved out
   * of the snapshot into its own column by plan 0133 section 4.3.
   *
   * No foreign key, exactly as every profile reference in this table's history:
   * the snapshot held a bare id too. Null on a basket composed before plan 0078,
   * which stays unpriced, and null on every `LIVE` basket, where it means "the
   * owner's default profile, resolved at read time" and plan 0136 does the
   * resolving.
   */
  @Column({ type: 'uuid', nullable: true })
  pricingProfileId!: string | null;

  /** Null for a run that carried no key; unique per owner when it did. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  idempotencyKey!: string | null;
}
