import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';

/** One chain the control offers. */
interface ChainOption {
  readonly id: string;
  readonly title: string;
}

/**
 * A chain, chosen from a short list (admin plan 0044).
 *
 * The harvester's filters name a chain: the one the four queues of Review are
 * narrowed to, and the one whose presets the Runs tab lists. There are a
 * handful of chains, so the control is a plain select and not a search box
 * with its results under it, which would push the queue down the page every
 * time it opened.
 *
 * The chains are the first page of the supermarkets, read once. A chain that
 * is chosen and is not on that page is read by itself and added, so the
 * control never shows a chosen chain as nothing.
 */
@Component({
  selector: 'lib-chain-select',
  imports: [RokuTranslatorPipe],
  template: `
    <select
      (change)="choose($event)"
      [attr.aria-label]="label() | rokuT"
      [id]="controlId()"
      [value]="value()"
    >
      <option [selected]="value() === ''" value="">
        {{ noneKey() | rokuT }}
      </option>
      @for (option of options(); track option.id) {
        <option [selected]="option.id === value()" [value]="option.id">
          {{ option.title }}
        </option>
      }
    </select>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }

    select {
      inline-size: 100%;
    }

    select:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainSelect {
  private readonly _references = inject(ResourceReferences);

  /** The id the `label` of the page points at. */
  readonly controlId = input.required<string>();
  /** The chosen chain's id, or `''` for none. */
  readonly value = input.required<string>();
  /** What the control is called for a screen reader, as a translation key. */
  readonly label = input.required<string>();
  /** What the entry for no chain says, as a translation key. */
  readonly noneKey = input.required<string>();

  /** A chain was chosen, or none with `''`. */
  readonly valueChange = output<string>();

  /** The first page of chains, or `null` until it has been read. */
  private readonly _page = signal<readonly ChainOption[] | null>(null);
  private readonly _listed = computed(() => this._page() ?? []);
  /** The chosen chain, when the first page did not hold it. */
  private readonly _extra = signal<ChainOption | null>(null);

  readonly options = computed<readonly ChainOption[]>(() => {
    const listed = this._listed();
    const extra = this._extra();

    return extra === null || listed.some((option) => option.id === extra.id)
      ? listed
      : [...listed, extra];
  });

  constructor() {
    void this._read();

    // A chosen chain that the list does not hold is read by itself, once
    // the list has answered: before that nothing says it is missing.
    effect(() => {
      const value = this.value();
      const listed = this._page();
      if (listed === null) {
        return;
      }
      const known = listed.some((option) => option.id === value);
      if (value !== '' && !known) {
        untracked(() => void this._resolve(value));
      }
    });
  }

  choose(event: Event): void {
    this.valueChange.emit((event.target as HTMLSelectElement).value);
  }

  private async _read(): Promise<void> {
    try {
      const options = await this._references.search('supermarkets', '');
      this._page.set(
        options.map((option) => ({ id: option.id, title: option.title }))
      );
    } catch {
      this._page.set([]);
      // The control then offers no chain and the queues stay whole. The page
      // under it says what failed, in its own words.
    }
  }

  private async _resolve(id: string): Promise<void> {
    const option = await this._references.resolve('supermarkets', id);
    if (option !== null && this.value() === id) {
      this._extra.set({ id: option.id, title: option.title });
    }
  }
}
