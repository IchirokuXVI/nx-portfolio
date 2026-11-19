import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HarvestRunMode } from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import { SourceCatalogEntry, type SupermarketSource } from '../entities';
import {
  DEZA_ADAPTER,
  dezaKeysRefusal,
  pendingMoves,
} from '../release-tasks/deza-keys';

/**
 * No DEZA walk runs while a stored row waits for its new key (backend plan
 * 0272, section 5.1, decision 51a).
 *
 * Between the rollout of a release that changes the size split and the end of
 * the release task that re-keys the stored rows, the new image runs and the
 * keys have not moved yet. A walk in that gap would write a new row beside
 * every moved one, and the row a person bound to a product would no longer be
 * seen. The spawn asks this guard in `validateRequest`, and the DEZA runner
 * asks it again before its first request.
 *
 * It reads the same selection as the task's command, so it can never wait for
 * something the task does not do. Collisions and unkeyed rows do not count:
 * the task never changes them. Only a `CATALOG_DISCOVERY` of a `deza-web`
 * source is guarded. A leaflet keys on its own text and a probe writes only
 * `source_probes`.
 *
 * It only reads, so it is not one of the writers a runner must not hold
 * (plan 0103, section 2.1).
 */
@Injectable()
export class DezaKeyGuard {
  constructor(
    @InjectRepository(SourceCatalogEntry)
    private readonly entries: Repository<SourceCatalogEntry>
  ) {}

  /** The refusal for this run, or null when it may start. */
  async refusal(
    source: Pick<SupermarketSource, 'adapterKey' | 'supermarketId'> | null,
    mode: HarvestRunMode
  ): Promise<string | null> {
    if (
      mode !== HarvestRunMode.CATALOG_DISCOVERY ||
      source?.adapterKey !== DEZA_ADAPTER
    ) {
      return null;
    }
    const pending = await pendingMoves(
      { query: (sql, params) => this.entries.query(sql, params) },
      source.supermarketId
    );
    return pending > 0 ? dezaKeysRefusal(pending) : null;
  }
}
