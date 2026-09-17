import type { HarvestRunPresetInput } from '@portfolio/luna-shopper/contracts';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A run request saved under a name (plan 0120, section 2).
 *
 * **Every preset belongs to a chain.** A store discovery around a postal code
 * belongs to no chain and is not a preset, and neither is a file import, which
 * needs a document uploaded at the time.
 *
 * The name is unique per chain **regardless of case**. That is an expression
 * index, `uq_harvest_run_presets_name` on (`supermarketId`, `lower(name)`), which
 * the migration creates and a decorator cannot state.
 *
 * A run started from a preset copies `input` when it starts and records the
 * preset's id with no foreign key, so editing or deleting a preset never changes
 * what a run did.
 */
@Entity({ name: 'harvest_run_presets' })
export class HarvestRunPreset extends BaseEntity {
  @Index('ix_harvest_run_presets_supermarket')
  @Column({ type: 'uuid' })
  supermarketId!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /**
   * The validated request, with the defaults of plan 0119 resolved, less the
   * credential and the chain (plan 0120, section 3).
   */
  @Column({ type: 'jsonb' })
  input!: HarvestRunPresetInput;

  @Column({ type: 'uuid' })
  createdByUserId!: string;

  @Column({ type: 'uuid' })
  updatedByUserId!: string;
}
