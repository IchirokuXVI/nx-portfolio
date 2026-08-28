import { ListRole } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ShoppingList } from './shopping-list.entity';
import { ZoneMembership } from './zone-membership.entity';

/**
 * Which zone members may read or write a list (plan 0007, section 1). Access is
 * granted per membership; reading a list requires a row here (reader or writer),
 * writing lines requires WRITER.
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

  @Column({ type: 'enum', enum: ListRole, default: ListRole.READER })
  role!: ListRole;
}
