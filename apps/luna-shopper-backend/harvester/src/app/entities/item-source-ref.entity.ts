import {
  ItemSourceMatch,
  ItemSourceRefStatus,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * The link between one catalog item and one chain's product (plan 0038, section
 * 4.2). **This is the table that makes a refresh cheap**: a REFRESH run costs one
 * request per tracked item rather than one per product in the chain's assortment,
 * which is the whole reason it exists.
 *
 * The matching ladder that writes it (section 6.2) has three rungs and only the
 * first two are trusted:
 *
 * 1. an `externalId` already recorded here, giving ACTIVE;
 * 2. an `ean` equal to a catalog item's, giving ACTIVE;
 * 3. normalized name plus brand plus size, giving **CANDIDATE**.
 *
 * A CANDIDATE is never used to write a price until the owner confirms it. A bad
 * fuzzy match writes a wrong price onto a real product that users then shop on,
 * which is worse than having no price at all.
 */
@Entity({ name: 'item_source_refs' })
@Index('uq_item_source_ref', ['itemId', 'supermarketId'], { unique: true })
export class ItemSourceRef extends BaseEntity {
  /** Opaque: catalog owns the item. */
  @Column({ type: 'uuid' })
  itemId!: string;

  /** Opaque: catalog owns the chain. */
  @Index('ix_item_source_refs_supermarket')
  @Column({ type: 'uuid' })
  supermarketId!: string;

  @Column({ type: 'varchar' })
  externalId!: string;

  @Column({ type: 'varchar', nullable: true })
  externalUrl!: string | null;

  @Column({ type: 'enum', enum: ItemSourceMatch })
  matchedBy!: ItemSourceMatch;

  @Index('ix_item_source_refs_status')
  @Column({
    type: 'enum',
    enum: ItemSourceRefStatus,
    default: ItemSourceRefStatus.CANDIDATE,
  })
  status!: ItemSourceRefStatus;

  /** 0..1. Only a NAME_BRAND_SIZE match carries anything below 1. */
  @Column({ type: 'numeric', precision: 4, scale: 3, default: 1 })
  confidence!: number;

  /** When the ref was last confirmed to point at a real product. */
  @Column({ type: 'timestamptz', nullable: true })
  lastResolvedAt!: Date | null;

  /** When a run last saw that product in the source at all. */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;
}
