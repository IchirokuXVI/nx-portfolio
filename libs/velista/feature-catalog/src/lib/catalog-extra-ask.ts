import { afterNextRender, DestroyRef, inject, Injector } from '@angular/core';
import {
  CatalogAddStore,
  MemberNames,
  SessionStore,
  type CatalogExtraReport,
} from '@portfolio/velista/data-access';
import type { VisitProduct } from '@portfolio/velista/models';
import {
  ExtraAskHost,
  type AnchoredPopoverSide,
  type Band,
} from '@portfolio/velista/ui';

/** Where one card's or table row's question goes (velista `0208`, targets 13 and 14). */
export interface CatalogExtraPlace {
  /** The control the raise was made on, or null once the results no longer draw it. */
  readonly origin: () => HTMLElement | null;
  /** The card or the table row, kept in sight beside the popover. */
  readonly keepInSight: () => HTMLElement | null;
  /** The board's side: below a card (frame 3), above a table row (frame 4). */
  readonly side: AnchoredPopoverSide;
}

/**
 * The question about the extra already bought on the catalog's cards and the
 * product page's table (velista `0208`, target states 13 and 14): called in the
 * page's injection context, with what says the page is in front. It connects the
 * page's `ExtraAskHost` and answers the two things a raise passes to
 * `CatalogAddStore`: the flag, and the callback that asks on the control once it is
 * drawn at the answered amount. The count is the store's, in the product's queue.
 */
export function catalogExtraAsk(
  inFront: () => boolean,
  band?: () => Band | null
) {
  const host = inject(ExtraAskHost);
  const adds = inject(CatalogAddStore);
  // Optional as in `CatalogAddStore`'s products: without the group's names every
  // buyer is "Someone", which the words already allow for.
  const names = inject(MemberNames, { optional: true });
  const session = inject(SessionStore);
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);

  host.connect({
    readerId: () => session.userId(),
    nameOf: (zoneId, userId) => names?.nameOf(zoneId, userId) ?? null,
    ...(band === undefined ? {} : { band }),
  });

  const zoneOf = (listId: string) =>
    adds.lists().find((list) => list.listId === listId)?.zoneId ?? null;

  return {
    host,
    /** The options of one raise: report, and ask at `place` when there is something to count. */
    options(product: Omit<VisitProduct, 'listId'>, place: CatalogExtraPlace) {
      return {
        reportExtra: true,
        onExtra: (report: CatalogExtraReport) => {
          // `CatalogAddStore` outlives the page, so an answer can land after the
          // page is gone: nobody is left to ask, and the amount set stands.
          if (destroyRef.destroyed) {
            return;
          }
          const zoneId = zoneOf(report.listId);
          const line = adds.held().find((one) => one.lineId === report.lineId);
          if (zoneId === null || line === undefined) {
            return;
          }
          const unit = line.unit ?? 'UNIT';
          // The members' names, for the words; until they arrive a buyer is "Someone",
          // and the words follow once they land.
          void names?.ensure(zoneId);
          const visit: VisitProduct = { ...product, listId: report.listId };
          afterNextRender(
            () =>
              host.ask({
                lineId: report.lineId,
                zoneId,
                unit,
                extra: report.extra,
                shown: report.quantity,
                origin: place.origin,
                keepInSight: place.keepInSight,
                side: place.side,
                count: async () => {
                  const outcome = await adds.countExtra(
                    visit,
                    report.lineId,
                    report.extra.countable,
                    report.quantity
                  );
                  return outcome === 'counted' ? 'done' : outcome;
                },
                inFront,
                // A reel whose tape is up asks once it is down.
                atRest: () =>
                  !(place.origin()?.matches('lib-quantity-reel.open') ?? false),
                // The card still shows Y: no newer step of the line since.
                current: () =>
                  adds.held().find((line) => line.lineId === report.lineId)
                    ?.quantity === report.quantity,
              }),
            { injector }
          );
        },
      };
    },
  };
}
