import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { ScopeLevel } from '@portfolio/luna-shopper-admin/models';

/**
 * How specific a price scope is, as four bars that rise (admin plan 0041,
 * section 10).
 *
 * Filled up to the level of the kind: one for nationwide, two for a chain
 * region, three for a local area, four for a single shop. A price belongs to a
 * scope and never to a shop, and a list of prices mixes all four kinds, so the
 * mark is what lets an operator see at a glance how far one price reaches
 * without reading the word beside it on every row.
 *
 * The bars carry no meaning by colour alone: the count is the meaning, and the
 * kind is the accessible name. Beside a visible word that already says the
 * kind, leave `label` empty and the mark is hidden from a screen reader, which
 * would otherwise hear the kind twice.
 */
@Component({
  selector: 'lib-scope-mark',
  template: `
    @for (bar of bars; track bar) {
      <i [class.filled]="bar <= level()"></i>
    }
  `,
  host: {
    '[attr.role]': 'named() ? "img" : null',
    '[attr.aria-label]': 'named() ? label() : null',
    '[attr.aria-hidden]': 'named() ? null : "true"',
    '[attr.data-level]': 'level()',
  },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      gap: 0.125rem;
      align-items: flex-end;
      block-size: 0.875rem;
      vertical-align: -0.0625rem;
    }

    i {
      inline-size: 0.25rem;
      border-radius: 1px;
      background: var(--admin-border-strong);
    }

    i:nth-child(1) {
      block-size: 0.3125rem;
    }

    i:nth-child(2) {
      block-size: 0.5rem;
    }

    i:nth-child(3) {
      block-size: 0.6875rem;
    }

    i:nth-child(4) {
      block-size: 0.875rem;
    }

    i.filled {
      background: var(--admin-accent);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopeMark {
  /** How many bars are filled, 1 to 4. */
  readonly level = input.required<ScopeLevel>();
  /**
   * The kind, already translated, as the accessible name.
   *
   * Empty where the kind is written beside the mark.
   */
  readonly label = input('');

  readonly named = computed(() => this.label() !== '');

  readonly bars = [1, 2, 3, 4] as const;
}
