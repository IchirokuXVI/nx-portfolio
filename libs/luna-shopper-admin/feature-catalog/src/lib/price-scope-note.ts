import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { RESOURCE_GATEWAYS } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  localizedTextValue,
} from '@portfolio/luna-shopper-admin/models';
import { locationGateway } from './locations';
import { priceScopeGateway, type PriceScope } from './price-scopes';

/** How many shops the note counts before it stops counting and says "at least". */
const COUNT_LIMIT = 100;

/** What the note has worked out about the scope a price is being written for. */
interface ScopeFacts {
  readonly kindKey: string;
  readonly externalKey: string;
  readonly label: string;
  readonly locations: number;
  /** Whether there were more shops than the note was willing to count. */
  readonly atLeast: boolean;
}

/**
 * What the scope a price is about actually is (plan 0005, section 2).
 *
 * **A price is not attached to a shop**, and this is the sentence that says so
 * at the moment it matters. `SupermarketItem` is keyed on
 * `(itemId, priceScopeId)`, Mercadona publishes one price per warehouse, and
 * twelve shops in Córdoba share it. An operator correcting a price they saw in
 * one of those shops is changing it for eleven others, and a form that did not
 * say so would let them do it believing otherwise.
 *
 * So the note names the scope, states its kind, and counts the shops it covers.
 * The count is the part that cannot be a descriptor: it is a second read, of a
 * different resource, about the value the operator has just chosen.
 *
 * It counts up to {@link COUNT_LIMIT} and then says "at least", rather than
 * paging a chain's entire estate to turn "a lot" into a number nobody needs. A
 * scope covering more shops than that has already made the point.
 */
@Component({
  selector: 'lib-price-scope-note',
  imports: [RokuTranslatorPipe],
  template: `
    <aside [class.unknown]="facts() === null">
      @if (scopeId() === '') {
        <p>{{ 'catalog.prices.scopeNote.none' | rokuT }}</p>
      } @else if (loading()) {
        <p>{{ 'catalog.prices.scopeNote.loading' | rokuT }}</p>
      } @else if (facts(); as scope) {
        <p class="what">
          <strong>{{ scope.kindKey | rokuT }}</strong>
          @if (scope.externalKey !== '') {
            <span class="key">{{ scope.externalKey }}</span>
          }
          @if (scope.label !== '') {
            <span class="label">{{ scope.label }}</span>
          }
        </p>

        <p class="covers">
          {{
            (scope.atLeast
              ? 'catalog.prices.scopeNote.coversAtLeast'
              : 'catalog.prices.scopeNote.covers'
            ) | rokuT: { count: scope.locations }
          }}
        </p>

        <p class="warning">{{ 'catalog.prices.scopeNote.warning' | rokuT }}</p>
      } @else {
        <p>{{ 'catalog.prices.scopeNote.missing' | rokuT }}</p>
      }
    </aside>
  `,
  styles: `
    :host {
      display: block;
    }

    aside {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    p {
      margin: 0;
    }

    .what {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: baseline;
    }

    .key {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .label,
    .covers {
      color: var(--admin-ink-muted);
    }

    .warning {
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceScopeNote {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);

  // Built in a field initializer, which runs during construction and is
  // therefore the injection context these factories need.
  private readonly _scopes = priceScopeGateway(this._gateways);
  private readonly _locations = locationGateway(this._gateways);

  /** The scope the form currently names, or `''` while none is chosen. */
  readonly scopeId = input.required<string>();

  readonly loading = signal(false);
  private readonly _facts = signal<ScopeFacts | null>(null);

  readonly facts = computed(() => this._facts());

  constructor() {
    effect(() => {
      const id = this.scopeId();
      if (id === '') {
        this._facts.set(null);
        return;
      }
      void this._describe(id);
    });
  }

  /**
   * Read the scope, then count what it reaches.
   *
   * Two requests rather than one, because no route answers both: a scope knows
   * its chain and its kind, and only the chain's shop list knows how many shops
   * point at it. The count is filtered by the scope, so it is the shops this
   * price will move and not the chain's whole estate.
   */
  private async _describe(id: string): Promise<void> {
    this.loading.set(true);
    this._facts.set(null);

    try {
      const scope = await this._scopes.read(id);
      const covered = await this._countLocations(scope);

      // A late answer for a scope the operator has already changed must not
      // land: they would read one scope's name beside another's shop count.
      if (this.scopeId() !== id) {
        return;
      }

      this._facts.set({
        kindKey: `catalog.priceScopeKind.${scope.kind}`,
        externalKey: scope.externalKey ?? '',
        label: localizedTextValue(scope.label, CONTENT_LOCALES),
        locations: covered.count,
        atLeast: covered.atLeast,
      });
    } catch {
      // A scope that cannot be read is drawn as one, rather than as a failure
      // of the form: the operator can still pick another.
      if (this.scopeId() === id) {
        this._facts.set(null);
      }
    } finally {
      if (this.scopeId() === id) {
        this.loading.set(false);
      }
    }
  }

  private async _countLocations(
    scope: PriceScope
  ): Promise<{ count: number; atLeast: boolean }> {
    const page = await this._locations.list({
      filters: {
        supermarketId: scope.supermarketId,
        priceScopeId: scope.id,
      },
      limit: COUNT_LIMIT,
    });

    return {
      count: page.items.length,
      atLeast: page.nextCursor !== null,
    };
  }
}
