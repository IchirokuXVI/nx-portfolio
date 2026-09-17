import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { DueLine } from '@portfolio/velista/models';
import { DueLineApi } from './due-line-api';

/**
 * The lines a zone list suggests (backend `0123`, amended by `0125`).
 *
 * One read and no write. A due line is taken by raising the line's quantity through
 * `LineStore`, and nothing is ever dismissed, so there is nothing here to send.
 */
export interface DueLineServiceI {
  /**
   * Every due line of one list (`GET /v1/lists/:id/suggestions`), most due first.
   *
   * Not paged. The page draws the first few and holds the rest for "Show more
   * suggestions" (velista `0089`, section 2).
   */
  listDueLines(listId: string): Promise<readonly DueLine[]>;
}

/** Inject this, typed as the interface. The default is the real gateway. */
export const DUE_LINE_SERVICE = serviceToken<DueLineServiceI>(
  'DUE_LINE_SERVICE',
  () => inject(DueLineApi)
);
