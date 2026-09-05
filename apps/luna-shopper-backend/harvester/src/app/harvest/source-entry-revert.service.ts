import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SourceEntryStatus } from '@portfolio/luna-shopper/contracts';
import { In, Repository } from 'typeorm';
import { SourceCatalogEntry, SourceEntryPrice } from '../entities';

/** The two statuses nobody has decided on yet. */
const UNDECIDED: readonly SourceEntryStatus[] = [
  SourceEntryStatus.CANDIDATE,
  SourceEntryStatus.UNRESOLVED,
];

export interface SourceEntryRevertResult {
  /** `source_entry_prices` rows this run claimed. */
  prices: number;
  /** Rows this run alone stands behind, and nobody decided on. */
  entries: number;
}

/**
 * The harvester's half of a revert (plan 0082, section 3, restated by plan 0086
 * section 8 for one table).
 *
 * Catalog's half runs first and deletes the `item_prices` rows stamped with the
 * run. What is left here is what the run wrote in the harvester's own database,
 * and the rule is that **a reverted run must not introduce anything**, including
 * work for a person.
 *
 * Four sentences, and the third and fourth are why this is not a one line
 * delete:
 *
 * - The run's `source_entry_prices` rows go. They are its claims, and an accept
 *   after the revert must not write them again.
 * - A row with `firstRunId = R` **and** `lastRunId = R`, in `CANDIDATE` or
 *   `UNRESOLVED`, goes. Nobody decided on it and no later run saw it.
 * - The second condition is the new one. A row this run created and a later run
 *   observed again is a real product a later run stands behind, and deleting it
 *   takes the later run's observation with it.
 * - A row in `ACTIVE` or `REJECTED` survives whatever run created it, because a
 *   person decided. A row this run merely touched keeps its `timesSeen` and its
 *   `lastSeenAt`: undoing a count would be inventing a past in which the chain
 *   never listed the product.
 */
@Injectable()
export class SourceEntryRevert {
  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>,
    @InjectRepository(SourceEntryPrice)
    private readonly prices: Repository<SourceEntryPrice>
  ) {}

  async revert(runId: string): Promise<SourceEntryRevertResult> {
    const prices = await this.prices.delete({ runId });
    const entries = await this.entries.delete({
      firstRunId: runId,
      lastRunId: runId,
      status: In([...UNDECIDED]),
    });
    return {
      prices: prices.affected ?? 0,
      entries: entries.affected ?? 0,
    };
  }
}
