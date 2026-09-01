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

  /**
   * The scope to quote this chain's prices from when nothing else says which
   * (plan 0049, section 3.1).
   *
   * The last rung of the ladder, and the reason it exists: "show me Mercadona"
   * with no location is ambiguous, because Mercadona prices per warehouse and
   * there is no single Mercadona price. First the chain's scopes serving the
   * caller's postal codes, then its NATIONAL scope if it has one, then this,
   * with the result **flagged as approximate** so a client can say "prices shown
   * for Madrid". Averaging across the chain's scopes is not an alternative: an
   * average price is a price that exists in no store.
   *
   * Owner set and nullable, and no foreign key: the column names a row of the
   * table two files over, but a constraint here would make deleting a scope
   * refuse rather than fall through to "this chain has no default", which is a
   * perfectly good answer.
   */
  @Column({ type: 'uuid', nullable: true })
  defaultPriceScopeId!: string | null;
}
