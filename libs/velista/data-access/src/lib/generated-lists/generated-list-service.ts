import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  GeneratedListSummary,
  Page,
  WritableGeneratedListStatus,
} from '@portfolio/velista/models';
import { GeneratedListApi } from './generated-list-api';

/**
 * The caller's generated shopping lists: making one, and reading the ones already made
 * (plan 0045, section 5).
 *
 * **Every method here is the owner's**: the dashboard card, the history page, the
 * generation sheet and, since velista `0057`, the control that ends a trip. All of
 * them resolve the caller from their own token, so no method takes a user id and
 * there is no way to address anybody else's baskets. Everything a **participant**
 * does inside a basket (joining by link, settling, allocating, swapping a pick, the
 * people on it) is plan 0044's, authenticated by a participant session rather than
 * an account token, and it does not belong on an interface whose every method is
 * "mine".
 *
 * Reading one whole basket is absent for the same reason: the only screen that needs
 * the lines is the basket screen, which reaches it as a participant.
 *
 * {@link setStatus} is the one **write** on this surface that a participant screen
 * calls, and it is here rather than on `BasketServiceI` precisely because of that
 * split: finishing a trip is the owner's alone, the route behind it is account
 * authenticated, and a guest holding a participant session cannot reach it with any
 * token they have (velista `0057`, section 2).
 */
export interface GeneratedListServiceI {
  /**
   * The caller's baskets, newest first, cursor paginated
   * (`GET /v1/generated-lists`, backend `0050` section 7).
   *
   * `ARCHIVED` ones are left out by the server unless asked for, and nothing in this
   * app asks: no screen archives a basket, so a listing that included them would show
   * rows that this build cannot explain the state of.
   */
  listMine(cursor?: string): Promise<Page<GeneratedListSummary>>;

  /**
   * Compose a basket (`POST /v1/generated-lists`, backend `0050` section 4).
   *
   * Answers the run rather than the basket: what a run **skipped** is part of the
   * answer to "why is this basket what it is", and a caller that discarded it would
   * have nothing to show somebody asking where the milk went.
   */
  create(request: CreateGeneratedListRequest): Promise<GeneratedListRun>;

  /**
   * Move a basket between statuses (`PATCH /v1/generated-lists/:id`, backend `0059`).
   *
   * The route has existed since backend `0050` and nothing called it until velista
   * `0057`: `COMPLETED` was a value the enum carried and no screen could write. What
   * calls it is the basket's own Finish control and the Reopen on its banner, which
   * are the same write in opposite directions.
   *
   * **It answers nothing**, and that is a decision rather than an omission. The
   * server replies with a whole `GeneratedListView`, lines included, which is a
   * different shape from the summaries this surface deals in and would have to be
   * counted down into one. The two readers of the change both learn it another way:
   * `GeneratedListStore` flips the status it already holds, and every open basket,
   * this caller's included, is told over the socket by `generatedList.updated`.
   */
  setStatus(
    generatedListId: string,
    status: WritableGeneratedListStatus
  ): Promise<void>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching `SHOPPING_PROFILE_SERVICE` and
 * `ZONE_SERVICE` for the reason recorded there: a wrong default that quietly works is
 * worse than one that fails loudly.
 */
export const GENERATED_LIST_SERVICE = serviceToken<GeneratedListServiceI>(
  'GENERATED_LIST_SERVICE',
  () => inject(GeneratedListApi)
);
