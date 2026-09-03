import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DetailFacts, DetailFrame, type DetailFact } from './detail-frame';
import { DetailPage } from './detail-page';
import { instant } from './people-format';
import type { BasketRow } from './people-seed';

/**
 * One shopping list, and its lines (plan 0007, section 2).
 *
 * Read only, like the standing list it was generated from, and for the same
 * reason: a basket line is bound to the list line it came from and to whatever
 * settlement the trip produced, and none of that is reachable by writing the
 * row.
 *
 * A basket belongs to a **person**, and the zones on it are the ones its lines
 * were drawn from, which is why there can be more than one and why none of them
 * owns it.
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
              @for (line of basket.lines; track line.id) {
                <li>
                  <div class="what">
                    <span class="content">{{ line.content }}</span>
                    <span class="muted">{{ createdAt(line.createdAt) }}</span>
                  </div>
                  <span class="quantity">{{ line.quantity }}</span>
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

    .rows li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
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

  constructor() {
    super();
    void this.load();
  }

  createdAt(value: string): string {
    return instant(value, this.locale);
  }
}
