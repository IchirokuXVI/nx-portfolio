import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  Page,
  PurchaseEntry,
  PurchaseEntryPage,
  PurchaseEntryRow,
} from '@portfolio/velista/models';
import { PurchaseApi } from './purchase-api';

/**
 * What the reader bought, with or without a basket (backend `0142`, velista `0095`).
 *
 * Two reads and no writes, both the account's own: the caller is resolved from the
 * token, so no method takes a user id. A guest has no history page.
 */
export interface PurchaseServiceI {
  /** One page of entries, newest first (`GET /v1/purchases/sessions`). */
  sessions(cursor?: string): Promise<PurchaseEntryPage>;

  /**
   * One page of one entry's rows (`GET /v1/purchases/sessions/:kind/:id/rows`), in the
   * order they were bought.
   *
   * An entry whose purchases were all taken back answers `not_found`. A session's id
   * can also disappear when a revert splits it.
   */
  rows(
    entry: Pick<PurchaseEntry, 'kind' | 'id'>,
    cursor?: string
  ): Promise<Page<PurchaseEntryRow>>;
}

/** Inject this, typed as the interface. The default is the real gateway. */
export const PURCHASE_SERVICE = serviceToken<PurchaseServiceI>(
  'PURCHASE_SERVICE',
  () => inject(PurchaseApi)
);
