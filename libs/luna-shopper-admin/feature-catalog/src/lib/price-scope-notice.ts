import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * What the price being edited actually applies to (plan 0005, section 2).
 *
 * This is the single most confusing thing in the domain and the place where a
 * well meaning admin screen creates wrong data. A price is **not** attached to a
 * shop: `SupermarketItem` is keyed on `(itemId, priceScopeId)`, because
 * Mercadona publishes one price per warehouse and the twelve shops that
 * warehouse serves share it. So "set the price of milk at this Mercadona" is
 * really "set it for warehouse 4661", which changes it for every shop that
 * warehouse serves.
 *
 * An interface that hides that is not simpler, it is wrong: an operator
 * correcting a price they saw in one shop would silently change it for eleven
 * others without being told. So the screen says the scope's name, its kind, and
 * how many shops it covers, and it says the count in words rather than leaving
 * the operator to work it out from the kind.
 *
 * Purely presentational: it is handed strings and a number and draws them.
 */
@Component({
  selector: 'lib-price-scope-notice',
  imports: [RokuTranslatorPipe],
  template: `
    <section [class.unknown]="scopeName() === null" role="note">
      @if (scopeName(); as name) {
        <p class="scope">
          {{ 'catalog.prices.scope.heading' | rokuT: { scope: name } }}
        </p>
        <p class="reach">
          {{ 'catalog.prices.scope.kind' | rokuT: { kind: kindLabel() } }}
        </p>
        @if (counting()) {
          <p class="reach">{{ 'catalog.prices.scope.counting' | rokuT }}</p>
        } @else if (locationCount(); as count) {
          <p class="reach">
            {{
              (atLeast()
                ? 'catalog.prices.scope.atLeastLocations'
                : 'catalog.prices.scope.locations'
              ) | rokuT: { count: count }
            }}
          </p>
        } @else {
          <p class="reach">{{ 'catalog.prices.scope.noLocations' | rokuT }}</p>
        }
      } @else {
        <p class="scope">{{ 'catalog.prices.scope.none' | rokuT }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      max-inline-size: 36rem;
    }

    section {
      padding: var(--admin-space-3) var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-inline-start-width: 4px;
      border-inline-start-color: var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    section.unknown {
      border-inline-start-color: var(--admin-border);
    }

    .scope {
      font-weight: 600;
    }

    .reach {
      margin-block-start: var(--admin-space-1);
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceScopeNotice {
  /** What the scope is called, or `null` when none has been chosen yet. */
  readonly scopeName = input<string | null>(null);
  /** The scope's kind, already translated by the page. */
  readonly kindLabel = input('');
  /** How many shops this price reaches. `null` until it is known. */
  readonly locationCount = input<number | null>(null);
  /**
   * Whether {@link locationCount} is a floor rather than the whole answer.
   *
   * Counting shops means walking pages, and the walk is bounded. A scope with
   * more shops than the bound reaches says "at least", which is true, rather
   * than a number that is not.
   */
  readonly atLeast = input(false);
  readonly counting = input(false);
}
