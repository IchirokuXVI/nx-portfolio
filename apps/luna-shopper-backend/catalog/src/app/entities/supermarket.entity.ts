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

  /**
   * The chain's stable identity across discovery runs and providers (plan 0038,
   * section 5.4), here the Wikidata QID (`Q377705`).
   *
   * Matching on the brand NAME splits one chain into several: `Dia` and `Maxi
   * Dia` are one chain sharing `Q925132`. It cuts the other way too, which is why
   * this is owner editable rather than authoritative: `Carrefour` and `Carrefour
   * Express` carry different QIDs, arguably correctly since their prices differ.
   * Nullable because an independent shop has none.
   */
  @Column({ type: 'varchar', nullable: true })
  externalBrandKey!: string | null;
}
