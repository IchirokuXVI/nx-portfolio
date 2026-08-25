import type { LocalizedText } from '@portfolio/luna-shopper/contracts';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A supermarket chain / brand (plan 0012, section 2): one row per brand, e.g.
 * "Mercadona". Its many physical stores are {@link SupermarketLocation} rows. The
 * localized name is stored multilingual (EN + ES minimum) as jsonb.
 */
@Entity({ name: 'supermarkets' })
export class Supermarket extends BaseEntity {
  @Column({ type: 'jsonb' })
  name!: LocalizedText;

  @Column({ type: 'varchar', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  websiteUrl!: string | null;
}
