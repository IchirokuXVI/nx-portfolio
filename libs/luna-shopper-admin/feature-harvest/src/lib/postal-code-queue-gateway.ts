import { computed, inject, Injectable, signal } from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  notFoundError,
  POSTAL_CODE_SERVICE,
  PostalCodeSummaryStore,
  type PostalCodeQuery,
} from '@portfolio/luna-shopper-admin/data-access';
import type {
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { toPostalCodeRow, type PostalCodeRow } from './postal-code-row';

/**
 * The country every code in this deployment belongs to.
 *
 * Spain, the same default the gateway route carries. It is on the add form as a
 * field rather than assumed, because a code without a country is not a code, but
 * nobody has ever changed it and the form should not make them.
 */
export const DEFAULT_POSTAL_CODE_COUNTRY = 'es';

/**
 * The postal code queue, as a resource (admin plan 0021, section 2).
 *
 * A hand written {@link ResourceGateway} rather than a {@link ResourceSource},
 * which plan 0004 anticipated: "a resource that does not fit writes its own
 * gateway and the descriptor names that instead". Three things do not fit, and
 * each of them is a route the harvester really has:
 *
 * - **There is no `GET /postal-codes/{id}`.** A row is found by reading the
 *   collection with the code as its filter, which is one request because the
 *   filter is the address.
 * - **A row is flattened** into {@link PostalCodeRow}, because two columns live
 *   inside a nested object and one comes from a different service.
 * - **The demand is one extra call per page**, and it is allowed to fail on its
 *   own without taking the listing with it.
 *
 * At root, and singly, so that {@link notices} and the list page are looking at
 * the same instance: the sentence saying the waiting column could not be filled
 * in is written by the read that could not fill it.
 */
@Injectable({ providedIn: 'root' })
export class PostalCodeQueueGateway implements ResourceGateway<PostalCodeRow> {
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _postalCodes = inject(POSTAL_CODE_SERVICE);
  private readonly _summary = inject(PostalCodeSummaryStore);
  private readonly _translator = inject(RokuTranslatorService);

  private readonly _usageFailed = signal(false);

  /** Whether the last page's waiting counts could not be read. */
  readonly usageFailed = this._usageFailed.asReadonly();

  /**
   * The sentences this screen has to say right now.
   *
   * Two, and neither is about the rows. A cluster with `HARVEST_ENABLED` false
   * queues codes that nothing ever drains, and an operator watching a row sit at
   * `QUEUED` for a week should be told why rather than left to work it out. A
   * blank waiting column reads as "nobody is waiting" unless something says it
   * is "we could not find out".
   */
  readonly notices = computed<readonly string[]>(() => {
    const sentences: string[] = [];
    if (this._summary.draining() === false) {
      sentences.push('harvest.postalCodes.notice.notDraining');
    }
    if (this._usageFailed()) {
      sentences.push('harvest.postalCodes.notice.demandUnavailable');
    }
    return sentences;
  });

  async list(query: ResourceQuery): Promise<ResourcePage<PostalCodeRow>> {
    // The banner above this list reads the summary, and this is the read that
    // brings the operator to the screen. Not awaited: a summary that is slow or
    // absent must not hold up the rows, which are the reason for the page.
    void this._summary.load();

    const page = await this._harvest.listPostalCodes(toQuery(query));
    const usage = await this._demand(page.items);
    const now = Date.now();
    const locale = this._translator.locale();

    return {
      items: page.items.map((view) =>
        toPostalCodeRow(view, usage.get(view.postalCode), now, locale)
      ),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * One row, addressed by its code.
   *
   * The address is the code rather than the uuid, because there is no route that
   * reads one row by its uuid and because a URL an operator can read is worth
   * having on a screen whose whole subject is a number people quote to each
   * other. The filter is a prefix, so the exact code is picked out of the answer
   * rather than taken from the front of it.
   */
  async read(id: string): Promise<PostalCodeRow> {
    const page = await this._harvest.listPostalCodes({ postalCode: id });
    const view = page.items.find((row) => row.postalCode === id);
    if (view === undefined) {
      throw notFoundError();
    }

    const usage = await this._demand([view]);
    return toPostalCodeRow(
      view,
      usage.get(view.postalCode),
      Date.now(),
      this._translator.locale()
    );
  }

  /**
   * Add one code.
   *
   * One code per call is the route's shape and the add screen's loop, so this is
   * the single call that screen repeats. What it answers is thrown away by the
   * caller, which only wants to know whether it worked and why not.
   */
  async create(input: ResourceInput): Promise<PostalCodeRow> {
    const view = await this._harvest.addPostalCode({
      country: String(input['country'] ?? DEFAULT_POSTAL_CODE_COUNTRY),
      postalCode: String(input['postalCode'] ?? ''),
      discoverNow: input['discoverNow'] !== false,
    });

    return toPostalCodeRow(
      view,
      undefined,
      Date.now(),
      this._translator.locale()
    );
  }

  /**
   * Neither of these exists, and the descriptor says so.
   *
   * There is nothing on the row an operator owns: everything is either the code
   * itself or the record of what happened to it (admin plan 0021, section 10).
   * The descriptor declares neither `edit` nor `delete`, so no screen offers
   * these, and a not found is what a caller that found one anyway deserves.
   */
  async update(): Promise<PostalCodeRow> {
    throw notFoundError();
  }

  async remove(): Promise<void> {
    throw notFoundError();
  }

  /**
   * How many people are waiting on each code of a page, in one call.
   *
   * **Never one call per row.** Twenty five requests to fill in one column is
   * not a decoration, it is a load, and plan 0074 section 3 says so. One call
   * per country on the page, which is one call, because a page of the Spanish
   * queue holds Spanish codes.
   *
   * A failure answers an empty map and raises the flag {@link notices} reads.
   * The rows still render and the listing still succeeds, which is the whole
   * rule: a decoration that can fail the listing is worse than no decoration.
   */
  private async _demand(
    views: readonly Wire.HarvestPostalCodeDiscoveryRequestView[]
  ): Promise<ReadonlyMap<string, Wire.AdminCorePostalCodeUsageView>> {
    const found = new Map<string, Wire.AdminCorePostalCodeUsageView>();
    if (views.length === 0) {
      this._usageFailed.set(false);
      return found;
    }

    const byCountry = new Map<string, string[]>();
    for (const view of views) {
      const codes = byCountry.get(view.country) ?? [];
      codes.push(view.postalCode);
      byCountry.set(view.country, codes);
    }

    try {
      for (const [country, codes] of byCountry) {
        const answer = await this._postalCodes.usage(country, codes);
        for (const row of answer.usage) {
          found.set(row.postalCode, row);
        }
      }
      this._usageFailed.set(false);
    } catch {
      this._usageFailed.set(true);
      return new Map();
    }

    return found;
  }
}

/** A list read, as the harvester's own query. */
function toQuery(query: ResourceQuery): PostalCodeQuery {
  const postalCode = query.filters?.['postalCode'];

  return {
    cursor: query.cursor,
    limit: query.limit,
    postalCode:
      postalCode === undefined || postalCode === '' ? undefined : postalCode,
  };
}
