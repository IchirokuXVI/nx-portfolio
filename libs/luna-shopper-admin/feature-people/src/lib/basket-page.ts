import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { toGatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
  routeParam,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { formatCurrencyAmount } from '@portfolio/luna-shopper-admin/models';
import { PageHeader } from '@portfolio/luna-shopper-admin/ui';
import {
  basketSettlements,
  type BasketSettlementView,
} from './basket-settlements';
import { FactList, type Fact } from './fact-list';
import { instant } from './people-format';
import type { BasketRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';
import { BASKET_PARAM, PERSON_PARAM } from './shopper-params';

/** A name the page looked up, and where the row it names lives. */
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
 * One shopping list, under the person who owns it (admin plan 0045, target 3).
 *
 * Its rows, what was bought of each, and every settlement: the outcome, how
 * many, what was paid, where and by whom (admin plan 0033). The shop of a
 * settlement is a link to that shop's page under its chain.
 *
 * **Read only, and it says so behind the info button.** A shopping list stores
 * no rows of its own: what is drawn is worked out from the lists it covers,
 * and from the record of the trip once it is finished. So there is nothing
 * here an operator could write, and the thing to change is the list it came
 * from.
 */
@Component({
  selector: 'lib-basket-page',
  imports: [PageHeader, RouterLink, FactList, RokuTranslatorPipe],
  template: `
    <lib-page-header
      [backLabel]="'people.baskets.back' | rokuT"
      [backLink]="listPath()"
      [frameTabs]="false"
      [heading]="heading() || ('resource.form.loading' | rokuT)"
      [info]="info"
      [subtitle]="'people.baskets.one' | rokuT"
    >
      @if (basket(); as row) {
        <span class="chip" pageChip>{{
          'people.baskets.status.' + row.status | rokuT
        }}</span>
      }
    </lib-page-header>

    @if (errorKey(); as key) {
      <p class="state error" role="alert">
        {{ key | rokuT }}
        <button (click)="load()" class="button small" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </p>
    } @else if (basket(); as row) {
      <lib-fact-list [facts]="facts()" />

      <section aria-labelledby="basket-rows-heading" class="block">
        <h3 id="basket-rows-heading">{{ 'people.baskets.lines' | rokuT }}</h3>
        @if (row.lines.length === 0) {
          <p class="state">{{ 'people.baskets.noLines' | rokuT }}</p>
        } @else {
          <ul class="panel" data-rows>
            @for (line of row.lines; track line.rowKey) {
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
      </section>
    } @else {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }
  `,
  styles: [
    PEOPLE_STYLES,
    `
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--admin-space-2);
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
        font-size: 0.8125rem;
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
export class BasketPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _references = inject(ResourceReferences);
  private readonly _translator = inject(RokuTranslatorService);

  private readonly _baskets = this._registry.byName('baskets');

  /** What the info button says: the basket descriptor's own words. */
  readonly info = this._baskets?.info ?? null;

  private readonly _id = signal<string | null>(null);
  private readonly _ownerId = signal<string | null>(
    routeParam(this._route.snapshot, PERSON_PARAM)
  );

  readonly basket = signal<BasketRow | null>(null);
  /** Why the shopping list could not be read, as a key, or `null`. */
  readonly errorKey = signal<string | null>(null);

  /** Names read for the shops and people the page names, by `resource:id`. */
  private readonly _names = signal<ReadonlyMap<string, Named>>(new Map());
  private readonly _asked = new Set<string>();

  /** So that an answer for a shopping list the page has left is dropped. */
  private _generation = 0;

  readonly heading = computed(() => {
    const basket = this.basket();
    return basket === null ? '' : (basket.name ?? basket.id);
  });

  /** The owner's Shopping lists tab, for the way back. */
  readonly listPath = computed(() => {
    const owner = this._ownerId() ?? this.basket()?.ownerUserId ?? null;
    return (
      this._registry.pathOf(
        'baskets',
        owner === null ? {} : { ownerUserId: owner }
      ) ?? ['/']
    );
  });

  readonly facts = computed<readonly Fact[]>(() => {
    const basket = this.basket();
    if (basket === null) {
      return [];
    }
    const names = this._names();
    const locale = this._translator.locale();

    return [
      {
        // Above the state, because it decides how to read it: a `LIVE` basket
        // is open for ever and that is not a trip somebody forgot to finish
        // (backend plan 0133, section 2).
        label: 'people.baskets.kind.label',
        text: this._translator.t(`people.baskets.kind.${basket.kind}`),
      },
      {
        label: 'people.baskets.status.label',
        text: this._translator.t(`people.baskets.status.${basket.status}`),
      },
      {
        label: 'people.baskets.ownerUserId',
        text:
          names.get(`users:${basket.ownerUserId}`)?.title ?? basket.ownerUserId,
        link: this._registry.rowPath('users', basket.ownerUserId),
      },
      ...basket.zoneIds.map((zoneId) => ({
        // One line per zone, so that each is a link of its own.
        label: 'people.baskets.zoneIds',
        text: names.get(`zones:${zoneId}`)?.title ?? zoneId,
        link: this._registry.rowPath('zones', zoneId),
      })),
      { label: 'people.baskets.lineCount', text: String(basket.lineCount) },
      {
        label: 'people.baskets.generatedAt',
        text: instant(basket.generatedAt, locale),
      },
      {
        label: 'people.baskets.updatedAt',
        text: instant(basket.updatedAt, locale),
      },
      { label: 'people.baskets.id', text: basket.id, mono: true },
    ];
  });

  /** Every row's settlements, mapped from the wire (rule D4), by row key. */
  private readonly _settlements = computed(() => {
    const byRow = new Map<string, readonly BasketSettlementView[]>();
    for (const line of this.basket()?.lines ?? []) {
      byRow.set(line.rowKey, basketSettlements(line.settlements));
    }
    return byRow;
  });

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(BASKET_PARAM);
      if (id !== null && id !== this._id()) {
        this._id.set(id);
        this._ownerId.set(routeParam(this._route.snapshot, PERSON_PARAM));
        this.basket.set(null);
        void this.load();
      }
    });
    inject(DestroyRef).onDestroy(() => params.unsubscribe());

    // Every zone, shop and person the page names, asked once each.
    effect(() => {
      const basket = this.basket();
      if (basket === null) {
        return;
      }
      this._name('users', basket.ownerUserId);
      for (const zoneId of basket.zoneIds) {
        this._name('zones', zoneId);
      }
      for (const settled of this._settlements().values()) {
        for (const settlement of settled) {
          this._name('locations', settlement.supermarketLocationId);
          this._name('users', settlement.settledByUserId);
        }
      }
    });
  }

  /** Read the shopping list again. */
  async load(): Promise<void> {
    const id = this._id();
    if (id === null || this._baskets === undefined) {
      return;
    }
    this._generation += 1;
    const generation = this._generation;
    this.errorKey.set(null);

    try {
      const row = await this._registry.gatewayFor(this._baskets).read(id);
      if (generation === this._generation) {
        this.basket.set(row as BasketRow);
      }
    } catch (error) {
      if (generation === this._generation) {
        this.basket.set(null);
        this.errorKey.set(
          gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
        );
      }
    }
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
