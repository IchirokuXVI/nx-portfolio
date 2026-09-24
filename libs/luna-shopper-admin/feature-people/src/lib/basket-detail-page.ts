import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { formatCurrencyAmount } from '@portfolio/luna-shopper-admin/models';
import {
  basketSettlements,
  type BasketSettlementView,
} from './basket-settlements';
import { DetailFacts, DetailFrame, type DetailFact } from './detail-frame';
import { DetailPage } from './detail-page';
import { instant } from './people-format';
import type { BasketRow } from './people-seed';

/**
 * One basket, and the rows it is showing (plan 0136).
 *
 * Read only, and more so than before: a basket stores no rows at all. What is
 * drawn is computed from the lists the basket covers, for an open basket, and
 * from `basket_trip_rows` for a finished one, so there is nothing here an
 * operator could write even if the screen offered it.
 *
 * A basket belongs to a **person**, and the zones on it are the ones its sources
 * name, which is why there can be more than one and why none of them owns it.
 */
@Component({
  selector: 'lib-basket-detail-page',
  imports: [DetailFrame, DetailFacts, RokuTranslatorPipe],
  template: `
    <lib-detail-frame
      (back)="back()"
      (retry)="load()"
      [errorKey]="errorKey()"
      [heading]="heading()"
      [kindKey]="descriptor.labels.one"
      [loading]="loading()"
    >
      @if (row(); as basket) {
        <lib-detail-facts [facts]="facts()" />

        <section>
          <h2>{{ 'people.baskets.lines' | rokuT }}</h2>
          @if (basket.lines.length === 0) {
            <p class="muted">{{ 'people.baskets.noLines' | rokuT }}</p>
          } @else {
            <ul class="rows">
              @for (row of basket.lines; track row.rowKey) {
                <li>
                  <div class="row-head">
                    <div class="what">
                      <span class="content">{{ row.content }}</span>
                      <span class="muted">
                        {{
                          'people.baskets.bought'
                            | rokuT: { bought: row.bought, asked: row.asked }
                        }}
                      </span>
                    </div>
                    <span class="quantity">{{ row.left }}</span>
                  </div>

                  <!-- What the row was settled as (admin plan 0033): the
                       outcome, how many, what was paid, where and by whom. -->
                  @if (settlementsOf(row.rowKey); as settled) {
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
                            <span class="quantity"
                              >×{{ settlement.quantity }}</span
                            >
                            @if (settlement.paid !== '') {
                              <span class="paid">{{ settlement.paid }}</span>
                            } @else {
                              <span class="muted">{{
                                'people.baskets.settlement.noPrice' | rokuT
                              }}</span>
                            }
                            @if (settlement.shop !== '') {
                              <span class="muted">
                                {{
                                  'people.baskets.settlement.at'
                                    | rokuT: { shop: settlement.shop }
                                }}
                              </span>
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
                            <span class="muted">{{
                              settlement.settledAt
                            }}</span>
                            @if (settlement.reverted) {
                              <span class="chip">{{
                                'people.baskets.settlement.reverted' | rokuT
                              }}</span>
                            }
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="muted">
                        {{ 'people.baskets.settlement.none' | rokuT }}
                      </p>
                    }
                  }
                </li>
              }
            </ul>
          }
        </section>
      }
    </lib-detail-frame>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-block-start: var(--admin-space-4);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .rows > li {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .row-head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
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
      font-size: 0.875rem;
    }

    .settlements li.reverted > :not(.chip) {
      text-decoration: line-through;
    }

    .outcome {
      font-weight: 600;
    }

    .outcome.NOT_AVAILABLE {
      color: var(--admin-danger-on-wash);
    }

    .paid {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }

    .chip {
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.75rem;
    }

    .what {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .content {
      font-weight: 600;
    }

    .quantity {
      font-variant-numeric: tabular-nums;
    }

    .muted {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketDetailPage extends DetailPage<BasketRow> {
  readonly heading = computed(() => {
    const basket = this.row();
    return basket === null ? this.id : (basket.name ?? basket.id);
  });

  readonly facts = computed<readonly DetailFact[]>(() => {
    const basket = this.row();
    if (basket === null) {
      return [];
    }

    return [
      { label: 'people.baskets.id', text: basket.id },
      { label: 'people.baskets.name', text: basket.name ?? '' },
      {
        // Above the state, because it decides how to read it: a `LIVE` basket
        // is open for ever and that is not a trip somebody forgot to finish
        // (backend plan 0133, section 2).
        label: 'people.baskets.kind.label',
        text: this.translator.t(`people.baskets.kind.${basket.kind}`),
      },
      {
        label: 'people.baskets.status.label',
        text: this.translator.t(`people.baskets.status.${basket.status}`),
      },
      { label: 'people.baskets.ownerUserId', text: basket.ownerUserId },
      { label: 'people.baskets.zoneIds', text: basket.zoneIds.join(', ') },
      { label: 'people.baskets.lineCount', text: String(basket.lineCount) },
      {
        label: 'people.baskets.generatedAt',
        text: instant(basket.generatedAt, this.locale),
      },
      {
        label: 'people.baskets.updatedAt',
        text: instant(basket.updatedAt, this.locale),
      },
    ];
  });

  private readonly _references = inject(ResourceReferences);
  /** Names read for the shops and people the settlements name, by id. */
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _asked = new Set<string>();

  /** Every row's settlements, mapped from the wire (rule D4), by row key. */
  private readonly _settlements = computed(() => {
    const basket = this.row();
    const byRow = new Map<string, readonly BasketSettlementView[]>();
    for (const line of basket?.lines ?? []) {
      byRow.set(line.rowKey, basketSettlements(line.settlements));
    }
    return byRow;
  });

  constructor() {
    super();
    void this.load();

    // Every shop and person the settlements name, asked once each.
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
  settlementsOf(rowKey: string) {
    const names = this._names();
    return (this._settlements().get(rowKey) ?? []).map((settlement) => ({
      id: settlement.id,
      outcome: settlement.outcome,
      quantity: settlement.quantity,
      paid: formatCurrencyAmount(
        settlement.paid,
        settlement.currency,
        this.locale
      ),
      shop:
        settlement.supermarketLocationId === null
          ? ''
          : (names.get(`locations:${settlement.supermarketLocationId}`) ??
            settlement.supermarketLocationId),
      // Only a participant id: the view does not say whether that participant
      // is a guest or a signed in member, so the screen does not guess.
      byParticipant:
        settlement.settledByUserId === null &&
        settlement.settledByParticipantId !== null,
      by:
        settlement.settledByUserId !== null
          ? (names.get(`users:${settlement.settledByUserId}`) ??
            settlement.settledByUserId)
          : (settlement.settledByParticipantId ?? ''),
      settledAt: instant(settlement.settledAt, this.locale),
      reverted: settlement.revertedAt !== null,
    }));
  }

  /**
   * Resolve one id through the resource it belongs to. The id stays where
   * nothing answers, which is what an unmounted resource or a reaped row
   * shows anyway (plan 0007, section 4).
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
          this._names.update((held) => new Map(held).set(key, option.title));
        }
      })
      .catch(() => {
        // The id stays.
      });
  }
}
