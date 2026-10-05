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

/** One settlement of one row, formatted for the screen. */
export interface SettlementLine {
  readonly id: string;
  readonly outcome: BasketSettlementView['outcome'];
  readonly quantity: number;
  /** What was paid, as money, or empty for a settlement with no price. */
  readonly paid: string;
  /** The shop it was settled at, or empty. */
  readonly shop: string;
  /** The shop's page under its chain, when the shop could be read. */
  readonly shopPath: readonly string[] | null;
  /** Whether only a participant id is known, and no account. */
  readonly byParticipant: boolean;
  readonly by: string;
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
                        @if (settlement.shop !== '') {
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
                        <span class="muted">
                          {{
                            settlement.byParticipant
                              ? ('people.baskets.settlement.byParticipant'
                                | rokuT: { id: settlement.by })
                              : ('people.baskets.settlement.by'
                                | rokuT: { name: settlement.by })
                          }}
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
  private readonly _names = signal<ReadonlyMap<string, Named>>(new Map());
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
      const shop =
        settlement.supermarketLocationId === null
          ? undefined
          : names.get(`locations:${settlement.supermarketLocationId}`);

      return {
        id: settlement.id,
        outcome: settlement.outcome,
        quantity: settlement.quantity,
        paid: formatCurrencyAmount(
          settlement.paid,
          settlement.currency,
          locale
        ),
        shop: shop?.title ?? settlement.supermarketLocationId ?? '',
        shopPath: shop?.path ?? null,
        // Only a participant id: the view does not say whether that
        // participant is a guest or a signed in member, so the screen does
        // not guess.
        byParticipant:
          settlement.settledByUserId === null &&
          settlement.settledByParticipantId !== null,
        by:
          settlement.settledByUserId !== null
            ? (names.get(`users:${settlement.settledByUserId}`)?.title ??
              settlement.settledByUserId)
            : (settlement.settledByParticipantId ?? ''),
        settledAt: instant(settlement.settledAt, locale),
        reverted: settlement.revertedAt !== null,
      };
    });
  }

  /**
   * Resolve one id through the resource it belongs to. The id stays where
   * nothing answers, which is what an unmounted resource or a reaped row
   * shows anyway (plan 0007, section 4).
   *
   * The row comes back with the name, and it is what gives a shop an address:
   * a shop lives under its chain, and the row says which chain that is.
   */
  private _name(resource: string, id: string | null): void {
    if (id === null) {
      return;
    }
    const key = `${resource}:${id}`;
    if (this._asked.has(key)) {
      return;
    }
    this._asked.add(key);
    this._references
      .resolve(resource, id)
      .then((option) => {
        if (option !== null) {
          const named: Named = {
            title: option.title,
            path: this._registry.rowPath(resource, id, option.row ?? {}),
          };
          this._names.update((held) => new Map(held).set(key, named));
        }
      })
      .catch(() => {
        // The id stays.
      });
  }
}
