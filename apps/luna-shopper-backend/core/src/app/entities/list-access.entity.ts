import { ListPermission } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingList } from './shopping-list.entity';
import { ZoneMembership } from './zone-membership.entity';

/**
 * What one zone member may do on one list (plan 0007, section 1; plan 0036).
 *
 * A **set** of permissions rather than a single role, because `WRITE` and
 * `DECIDE` describe two different people and neither contains the other: the
 * flatmate who puts olive oil on the list on Tuesday, and the flatmate who is in
 * the shop on Saturday deciding it goes in the trolley (plan 0036, section 2.1).
 *
 * Two invariants live at the write boundary rather than in every predicate that
 * reads a row (plan 0036, section 2.2):
 *
 * - every stored set contains `READ`, which `setAccess` adds to any non-empty
 *   set, so a predicate asking "may this caller see the list" asks for `READ`
 *   literally and nothing has to remember to imply it;
 * - an empty set is never stored, it is a deleted row. No row is then the single
 *   representation of no access, which keeps `READABLE_LIST` a one line predicate
 *   and stops a zero permission row silently satisfying an `EXISTS`.
 *
 * Zone OWNERs and ADMINs hold all four on every list in their zone and have no
 * row here at all: that grant is derived from `ZoneRole` at check time, so a
 * promotion is one `UPDATE` on one membership row rather than a write per list
 * that can drift (plan 0036, section 2.4).
 *
 * The column is `NOT NULL` with **no default**. A default would make "somebody
 * inserted a row and forgot to say what it grants" a silent state rather than an
 * error, and every writer of this table knows the set it means to store.
 */
@Entity({ name: 'list_access' })
@Index('uq_list_access', ['listId', 'membershipId'], { unique: true })
export class ListAccess extends BaseEntity {
  @Column({ type: 'uuid' })
  listId!: string;

  @ManyToOne(() => ShoppingList, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listId' })
  list!: ShoppingList;

  @Column({ type: 'uuid' })
  membershipId!: string;

  @ManyToOne(() => ZoneMembership, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'membershipId' })
  membership!: ZoneMembership;

  @Column({ type: 'enum', enum: ListPermission, array: true })
  permissions!: ListPermission[];
}
