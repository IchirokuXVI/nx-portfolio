import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  RECORD_CONTEXT,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { formatCurrencyAmount } from '@portfolio/luna-shopper-admin/models';
import { RecordSection } from '@portfolio/luna-shopper-admin/ui';
import {
  basketSettlements,
  type BasketSettlementView,
} from './basket-settlements';
import { instant } from './people-format';
import type { BasketRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';

/** What the shopping list descriptor calls this panel among its children. */
export const BASKET_LINES_PANEL = 'lines';

/** A name the panel looked up, and where the row it names lives. */
interface Named {
  readonly title: string;
  readonly path: readonly string[] | null;
}

/**
 * What the read of one name answered: the name, a record that is gone (the
 * read answered 404), or a read that failed. An id with no entry is still
 * being read. The same states `FieldValue` draws for a reference.
 */
type NameRead = Named | 'gone' | 'unread';

/** What is said in place of a name, by what is named and by its state. */
const SAID = {
  locations: {
    reading: 'resource.reference.resolving',
    gone: 'people.baskets.settlement.shopGone',
    unread: 'people.baskets.settlement.shopUnread',
  },
  users: {
    reading: 'resource.reference.resolving',
    gone: 'people.baskets.settlement.byGone',
    unread: 'people.baskets.settlement.byUnread',
  },
} as const;

/** One settlement of one row, formatted for the screen. */
export interface SettlementLine {
  readonly id: string;
  readonly outcome: BasketSettlementView['outcome'];
  readonly quantity: number;
  /** What was paid, as money, or empty for a settlement with no price. */
  readonly paid: string;
  /** The shop it was settled at, or empty. Its name and never its id. */
  readonly shop: string;
  /**
   * A translation key drawn in place of the shop, while its name is read,
   * when the shop is gone and when the read failed. `null` otherwise.
   */
  readonly shopSaid: string | null;
  /** The shop's page under its chain, when the shop could be read. */
  readonly shopPath: readonly string[] | null;
  /** Whether only a participant id is known, and no account. */
  readonly byParticipant: boolean;
  /** The name of the account, or the id of the participant. */
  readonly by: string;
  /** The same as {@link shopSaid}, for the account that settled. */
  readonly bySaid: string | null;
  readonly settledAt: string;
  readonly reverted: boolean;
}

/**
 * The rows of a shopping list, as a panel of its record page (admin plan
 * 0058, section 2.3).
 *
 * It was the rows block of `BasketPage`, and is that block as it was: each
 * row, what was bought of it, and every settlement: the outcome, how many,
 * what was paid, where and by whom (admin plan 0033). The shop of a
 * settlement is a link to that shop's page under its chain.
 *
 * **It only reads.** A shopping list stores no rows of its own: what is drawn
 * is worked out from the lists it covers, and from the record of the trip
 * once it is finished. The info button of the page says so.
 *
 * The rows come with the shopping list's own read, so the panel learns them
 * from `RECORD_CONTEXT` and makes no request for them. It reads only the
 * names of the shops and the people its settlements name.
 */
@Component({
  selector: 'lib-basket-lines-panel',
  imports: [RouterLink, RokuTranslatorPipe, RecordSection],
  template: `
    <lib-record-section [heading]="'people.baskets.record.lines' | rokuT">
      @if (rows().length === 0) {
        <p class="empty" data-empty>{{ 'people.baskets.noLines' | rokuT }}</p>
      } @else {
        <ul class="rows" data-rows>
          @for (line of rows(); track line.rowKey) {
            <li class="row basket-row">
              <div class="row-head">
                <span class="row-main">
                  <span class="row-title">{{ line.content }}</span>
                  <span class="row-line">
                    {{
                      'people.baskets.bought'
                        | rokuT: { bought: line.bought, asked: line.asked }
                    }}
                  </span>
                </span>
                <span class="num">{{
                  'people.baskets.left' | rokuT: { count: line.left }
                }}</span>
              </div>

              <!-- What the row was settled as: the outcome, how many, what
                   was paid, where and by whom. -->
              @if (settlementsOf(line.rowKey); as settled) {
                @if (settled.length > 0) {
                  <ul class="settlements">
                    @for (settlement of settled; track settlement.id) {
                      <li [class.reverted]="settlement.reverted">
                        <span [class]="settlement.outcome" class="outcome">
                          {{
                            'people.baskets.settlement.outcome.' +
                              settlement.outcome | rokuT
                          }}
                        </span>
                        <span class="num">×{{ settlement.quantity }}</span>
                        @if (settlement.paid !== '') {
                          <span class="paid num">{{ settlement.paid }}</span>
                        } @else {
                          <span class="muted">{{
                            'people.baskets.settlement.noPrice' | rokuT
                          }}</span>
                        }
                        @if (settlement.shopSaid; as said) {
                          <span class="muted" data-shop>{{
                            said | rokuT
                          }}</span>
                        } @else if (settlement.shop !== '') {
                          @if (settlement.shopPath; as path) {
                            <a [routerLink]="path" class="link" data-shop>{{
                              'people.baskets.settlement.at'
                                | rokuT: { shop: settlement.shop }
                            }}</a>
                          } @else {
                            <span class="muted" data-shop>{{
                              'people.baskets.settlement.at'
                                | rokuT: { shop: settlement.shop }
                            }}</span>
                          }
                        }
                        <span class="muted" data-by>
                          @if (settlement.bySaid; as said) {
                            {{ said | rokuT }}
                          } @else {
                            {{
                              settlement.byParticipant
                                ? ('people.baskets.settlement.byParticipant'
                                  | rokuT: { id: settlement.by })
                                : ('people.baskets.settlement.by'
                                  | rokuT: { name: settlement.by })
                            }}
                          }
                        </span>
                        <span class="muted">{{ settlement.settledAt }}</span>
                        @if (settlement.reverted) {
                          <span class="chip">{{
                            'people.baskets.settlement.reverted' | rokuT
                          }}</span>
                        }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="muted small">
                    {{ 'people.baskets.settlement.none' | rokuT }}
                  </p>
                }
              }
            </li>
          }
        </ul>
      }
    </lib-record-section>
  `,
  styles: [
    PEOPLE_STYLES,
    `
      /* A panel among the sections of the page, and not a page of its own. */
      :host {
        display: block;
        flex: none;
      }

      .rows {
        list-style: none;
      }

      /* Every row has a line above it: the first one sits under the heading
         of the section. */
      .row:first-child,
      .empty {
        border-block-start: 1px solid var(--admin-border);
      }

      .empty {
        padding: var(--admin-space-3) var(--admin-space-4);
        color: var(--admin-ink-muted);
      }

      .basket-row {
        flex-direction: column;
        gap: var(--admin-space-2);
        align-items: stretch;
        padding-block: var(--admin-space-3);
      }

      .row-head {
        display: flex;
        gap: var(--admin-space-3);
        align-items: center;
        justify-content: space-between;
      }

      .row-head > .num {
        flex: none;
      }

      .settlements {
        display: flex;
        flex-direction: column;
        gap: var(--admin-space-1);
        padding-inline-start: var(--admin-space-3);
        border-inline-start: 2px solid var(--admin-border);
        list-style: none;
      }

      .settlements li {
        display: flex;
        flex-wrap: wrap;
        gap: var(--admin-space-1) var(--admin-space-3);
        align-items: baseline;
        min-inline-size: 0;
        font-size: 0.8125rem;
        overflow-wrap: anywhere;
      }

      .settlements li.reverted > :not(.chip) {
        text-decoration: line-through;
      }

      .outcome,
      .paid {
        font-weight: 600;
      }

      .outcome.NOT_AVAILABLE {
        color: var(--admin-danger-on-wash);
      }

      .small {
        font-size: 0.8125rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketLinesPanel {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _references = inject(ResourceReferences);
  private readonly _translator = inject(RokuTranslatorService);

  private readonly _record = inject(RECORD_CONTEXT);

  /**
   * The shopping list, as the page read it. The read of one carries its
   * rows, which the descriptor names as no field.
   */
  private readonly _basket = computed(
    () => this._record.row() as BasketRow | null
  );

  readonly rows = computed(() => this._basket()?.lines ?? []);

  /** Names read for the shops and people the panel names, by `resource:id`. */
  private readonly _names = signal<ReadonlyMap<string, NameRead>>(new Map());
  private readonly _asked = new Set<string>();

  /** Every row's settlements, mapped from the wire (rule D4), by row key. */
  private readonly _settlements = computed(() => {
    const byRow = new Map<string, readonly BasketSettlementView[]>();
    for (const line of this.rows()) {
      byRow.set(line.rowKey, basketSettlements(line.settlements));
    }
    return byRow;
  });

  constructor() {
    // Every shop and person a settlement names, asked once each.
    effect(() => {
      for (const settled of this._settlements().values()) {
        for (const settlement of settled) {
          this._name('locations', settlement.supermarketLocationId);
          this._name('users', settlement.settledByUserId);
        }
      }
    });
  }

  /** One row's settlements, formatted for the screen. */
  settlementsOf(rowKey: string): readonly SettlementLine[] {
    const names = this._names();
    const locale = this._translator.locale();

    return (this._settlements().get(rowKey) ?? []).map((settlement) => {
      const shop = nameOf(names, 'locations', settlement.supermarketLocationId);
      const by = nameOf(names, 'users', settlement.settledByUserId);

      return {
        id: settlement.id,
        outcome: settlement.outcome,
        quantity: settlement.quantity,
        paid: formatCurrencyAmount(
          settlement.paid,
          settlement.currency,
          locale
        ),
        shop: shop.named?.title ?? '',
        shopSaid: shop.said,
        shopPath: shop.named?.path ?? null,
        // Only a participant id: the view does not say whether that
        // participant is a guest or a signed in member, so the screen does
        // not guess.
        byParticipant:
          settlement.settledByUserId === null &&
          settlement.settledByParticipantId !== null,
        by:
          settlement.settledByUserId !== null
            ? (by.named?.title ?? '')
            : (settlement.settledByParticipantId ?? ''),
        bySaid: by.said,
        settledAt: instant(settlement.settledAt, locale),
        reverted: settlement.revertedAt !== null,
      };
    });
  }

  /**
   * Resolve one id through the resource it belongs to. The id itself is
   * never drawn: where there is no name, the panel says why there is none.
   * "Gone" is said only of a row the server said is gone.
   *
   * The row comes back with the name, and it is what gives a shop an address:
   * a shop lives under its chain, and the row says which chain that is.
   */
  private _name(resource: keyof typeof SAID, id: string | null): void {
    if (id === null) {
      return;
    }
    const key = `${resource}:${id}`;
    if (this._asked.has(key)) {
      return;
    }
    this._asked.add(key);
    const hold = (read: NameRead) =>
      this._names.update((held) => new Map(held).set(key, read));

    this._references
      .read(resource, id)
      .then((read) =>
        hold(
          read.state === 'found'
            ? {
                title: read.option.title,
                path: this._registry.rowPath(
                  resource,
                  id,
                  read.option.row ?? {}
                ),
              }
            : read.state === 'gone'
              ? 'gone'
              : 'unread'
        )
      )
      .catch(() => hold('unread'));
  }
}

/**
 * The name of one id, or the key of what is said in its place. Neither for
 * an id that is `null`: the settlement names no shop, or no account.
 */
function nameOf(
  names: ReadonlyMap<string, NameRead>,
  resource: keyof typeof SAID,
  id: string | null
): { readonly named: Named | null; readonly said: string | null } {
  if (id === null) {
    return { named: null, said: null };
  }
  const read = names.get(`${resource}:${id}`);
  if (read === undefined) {
    return { named: null, said: SAID[resource].reading };
  }
  return typeof read === 'string'
    ? { named: null, said: SAID[resource][read] }
    : { named: read, said: null };
}
