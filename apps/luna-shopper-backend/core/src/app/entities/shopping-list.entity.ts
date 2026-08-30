import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Zone } from './zone.entity';

/** A shopping list inside a zone (plan 0007, section 1). */
@Entity({ name: 'shopping_lists' })
// Serves the zone lists preview, newest activity first (plan 0017, 4.3). The
// migration declares the `updatedAt` leg DESC, which this decorator cannot
// express; the migration is the schema of record.
@Index('ix_lists_zone_updated', ['zoneId', 'updatedAt', 'id'])
export class ShoppingList extends BaseEntity {
  @Column({ type: 'uuid' })
  zoneId!: string;

  @ManyToOne(() => Zone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zoneId' })
  zone!: Zone;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  /**
   * Whether a new line on this list is approved the moment it is added (plan
   * 0037, section 3).
   *
   * List configuration rather than a member's preference: changing it needs
   * `MANAGE`, and it is per list rather than per zone because one household can
   * perfectly well run a no questions asked weekly shop and a budgeted list for
   * the big monthly one in the same group.
   *
   * It governs only what a **new** line starts as. Turning it on leaves existing
   * pending lines pending, a `DECIDE` holder may still reject an auto approved
   * line, and editing a rejected line still returns it to `PENDING` rather than
   * straight back to `APPROVED`. It also turns off the quantity split of section
   * 4, because a list that auto approves has decided approval carries no
   * information on it and there is then nothing for a remainder line to preserve.
   *
   * Defaults to false, which is what every list created before this shipped had.
   */
  @Column({ type: 'boolean', default: false })
  autoApproveLines!: boolean;

  /**
   * Whether this list is open to every approved member of its zone (plan 0042,
   * section 2.1).
   *
   * List configuration, changed with `MANAGE`, and the column this one most
   * resembles is `autoApproveLines` beside it: both govern what happens to the
   * next thing rather than acting on what is already there.
   *
   * It exists because sharing used to be an **action** taken once at creation.
   * `shareWithZone` granted every member approved at that instant and was then
   * over, so everybody invited afterwards saw nothing and no query could recover
   * the intent: a list shared with a group of one looked exactly like a private
   * one. As state it can be read later, which is what lets the approval path
   * grant a new member the zone's shared lists.
   *
   * Turning it **off** revokes nobody. It stops new members being granted and
   * leaves every existing row alone, because a switch that silently removed
   * eight people from a list they had been using all week would be doing
   * something other than what it says (section 2.2).
   *
   * Defaults to false so a row the backfill misses is private rather than
   * accidentally open.
   */
  @Column({ type: 'boolean', default: false })
  sharedWithZone!: boolean;
}
