import {
  ItemSourceMatch,
  SourceLocationStatus,
} from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Which shop of theirs is which of ours (plan 0084, section 6).
 *
 * A source that answers availability per shop names its shops in its own
 * vocabulary, and only a person can say which catalog location each one is.
 *
 * **The key is the source's own code, not the name it prints.** DEZA labels each
 * shop `T1` to `T7`, `C1`, `C2` and `Z1` in the markup and prints "Ronda del
 * Marrubial" beside it. Only the first survives a rename. A mapping keyed on the
 * display name detaches the day marketing retitles a shop, and detaches into
 * `UNMAPPED`, which reads as "they closed it".
 *
 * **Why not a column on `SupermarketLocation`.** The same argument plan 0081
 * section 2 makes about `SourceCatalogEntry`. A column holds one name per
 * location and a chain names one shop several ways over time. It also teaches
 * catalog a source's vocabulary, and catalog is the thing that must not know
 * which chains we happen to crawl. A separate table in the harvester has neither
 * problem.
 */
@Entity({ name: 'source_locations' })
@Index('uq_source_location', ['supermarketId', 'externalId'], { unique: true })
export class SourceLocation extends BaseEntity {
  /** Opaque: catalog owns the chain. */
  @Column({ type: 'uuid' })
  supermarketId!: string;

  /** The source's own key for the shop, e.g. `T1`. */
  @Column({ type: 'varchar' })
  externalId!: string;

  /** What the source displayed, exactly. Never the key, and never normalized. */
  @Column({ type: 'varchar' })
  printedName!: string;

  /** Opaque: catalog owns the location. Set on `ACTIVE` only. */
  @Column({ type: 'uuid', nullable: true })
  supermarketLocationId!: string | null;

  @Index('ix_source_locations_status')
  @Column({
    type: 'enum',
    enum: SourceLocationStatus,
    enumName: 'source_location_status',
    default: SourceLocationStatus.UNMAPPED,
  })
  status!: SourceLocationStatus;

  /**
   * `NAME_SIZE` for the default exact name match, `MANUAL` when a person bound
   * it. The back office shows it as a column rather than a detail: a row bound
   * by the automatic match and a row bound by a person look identical otherwise
   * and carry different confidence.
   */
  @Column({
    type: 'enum',
    enum: ItemSourceMatch,
    enumName: 'item_source_match',
    default: ItemSourceMatch.NAME_SIZE,
  })
  matchedBy!: ItemSourceMatch;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  /** The run that created the row. Opaque, never joined. */
  @Column({ type: 'uuid', nullable: true })
  firstRunId!: string | null;

  /** The run that last saw the shop. */
  @Column({ type: 'uuid', nullable: true })
  lastRunId!: string | null;
}
