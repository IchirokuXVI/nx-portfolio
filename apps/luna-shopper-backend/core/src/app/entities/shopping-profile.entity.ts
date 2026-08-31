import { GenerationScope } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * One way a person shops (plan 0049, section 1): a postal code or three, the
 * chains they will and will not set foot in, and what a second stop has to save.
 *
 * **Core owns it** (section 2), keyed by an opaque `userId` and referencing
 * catalog only by an opaque `supermarketId`, exactly as `ListLineItem`
 * references an item. The heaviest consumer is the basket generator in plan
 * 0050, which is core work over core data.
 *
 * `name` is nullable and null is not missing: the client renders the localized
 * default, because core does not know the caller's locale and a stored English
 * word in a Spanish account is wrong forever (section 1.3).
 *
 * `isDefault` carries the one invariant worth stating twice: **exactly one per
 * user**, enforced by a partial unique index rather than by the service alone,
 * which is what makes the lazy creation in section 1.3 idempotent under two
 * concurrent first reads.
 */
@Entity({ name: 'shopping_profiles' })
export class ShoppingProfile extends BaseEntity {
  @Index('ix_shopping_profiles_user')
  @Column({ type: 'uuid' })
  userId!: string;

  /** Trimmed and capped at 64 so the client's one line truncation is cosmetic. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  name!: string | null;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  /** The order the selector shows them in. */
  @Column({ type: 'integer', default: 0 })
  position!: number;

  /**
   * Free text: "Calle Mayor 12". Display and context only. **Nothing is
   * geocoded**; the postal codes below are what resolve to price scopes.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  addressText!: string | null;

  /**
   * The money a second stop has to save before the generator suggests it. Here
   * because it is per profile; what it means is backlog 0004, section 5.
   */
  @Column({ type: 'integer', default: 0 })
  minSavingCents!: number;

  /** The optional relative floor beside the absolute one. */
  @Column({ type: 'integer', nullable: true })
  minSavingPercent!: number | null;

  @Column({
    type: 'enum',
    enum: GenerationScope,
    default: GenerationScope.ALL,
  })
  generationScope!: GenerationScope;
}
