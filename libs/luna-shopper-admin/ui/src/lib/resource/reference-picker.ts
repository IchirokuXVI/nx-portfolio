import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
  type OnDestroy,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  ReferenceLookup,
  ReferenceOption,
  ReferenceScope,
} from './reference-lookup';

/** How long typing settles before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * A uuid, chosen by name (plan 0004, section 6).
 *
 * Two states, and the difference is the whole design. When the field has a
 * value the control shows **what it points at**, by name, with a way to change
 * it and, where the column allows, a way to empty it. When it does not, the
 * control is a search box.
 *
 * **Empty is an answer here, not an omission.** `productGroupId` being null is
 * the resting state of a freshly harvested product, so a nullable reference
 * offers "nothing" as a choice and says nothing about the field being blank. A
 * picker that nagged about it would nag on almost every product in the catalog.
 *
 * A reference whose target no longer exists says so rather than showing an
 * empty box, because those are different problems and only one of them is fixed
 * by picking something.
 */
@Component({
  selector: 'lib-reference-picker',
  imports: [RokuTranslatorPipe],
  template: `
    @if (value() !== '' && !changing()) {
      <p class="chosen">
        @if (resolving()) {
          <span class="muted">{{
            'resource.reference.resolving' | rokuT
          }}</span>
        } @else if (chosen(); as option) {
          <span class="name">{{ option.title }}</span>
        } @else {
          <span class="missing">{{
            'resource.reference.missing' | rokuT: { id: value() }
          }}</span>
        }

        <button (click)="startChanging()" [disabled]="disabled()" type="button">
          {{ 'resource.reference.change' | rokuT }}
        </button>

        @if (nullable()) {
          <button (click)="clear()" [disabled]="disabled()" type="button">
            {{ 'resource.reference.clear' | rokuT }}
          </button>
        }
      </p>
    } @else {
      <input
        (input)="onSearch($event)"
        [attr.aria-label]="'resource.reference.search' | rokuT"
        [disabled]="disabled()"
        [id]="controlId()"
        [value]="term()"
        autocapitalize="none"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        type="search"
      />

      @if (searching()) {
        <p class="muted">{{ 'resource.reference.searching' | rokuT }}</p>
      } @else if (options().length === 0) {
        <p class="muted">{{ 'resource.reference.noResults' | rokuT }}</p>
      } @else {
        <ul>
          @for (option of options(); track option.id) {
            <li>
              <button (click)="choose(option)" type="button">
                {{ option.title }}
              </button>
            </li>
          }
        </ul>
      }

      @if (nullable() && value() !== '') {
        <button (click)="clear()" [disabled]="disabled()" type="button">
          {{ 'resource.reference.clear' | rokuT }}
        </button>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
    }

    .chosen {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
    }

    .name {
      font-weight: 600;
    }

    .missing {
      color: var(--admin-danger);
    }

    .muted {
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
    }

    input {
      /* 1rem exactly: iOS Safari zooms the viewport on focus for anything
         smaller, which on a phone leaves the operator scrolled sideways. */
      font: inherit;
      font-size: 1rem;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      color: var(--admin-ink);
    }

    ul {
      display: flex;
      flex-direction: column;
      max-block-size: 14rem;
      overflow-y: auto;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      list-style: none;
    }

    li button {
      inline-size: 100%;
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: none;
      background: none;
      font: inherit;
      text-align: start;
      color: var(--admin-ink);
      cursor: pointer;
    }

    .chosen button {
      min-block-size: 2.25rem;
      padding: var(--admin-space-1) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferencePicker implements OnDestroy {
  readonly controlId = input.required<string>();
  /** The resource being pointed at, by descriptor name. */
  readonly resource = input.required<string>();
  /** The id currently held, or `''`. */
  readonly value = input.required<string>();
  readonly lookup = input.required<ReferenceLookup>();
  /**
   * What the screen has already decided, sent with every search.
   *
   * The mapping screen of plan 0011 is what this exists for: its picker is over
   * one chain's shops, and that collection cannot be read at all until the
   * chain is named. Empty for every picker whose target lists from nothing.
   */
  readonly scope = input<ReferenceScope>({});
  readonly nullable = input(false);
  readonly disabled = input(false);

  readonly valueChange = output<string>();

  readonly term = signal('');
  readonly options = signal<readonly ReferenceOption[]>([]);
  readonly searching = signal(false);
  readonly resolving = signal(false);
  readonly chosen = signal<ReferenceOption | null>(null);
  /** Whether the operator asked to replace a value that is already there. */
  readonly changing = signal(false);

  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** The search this component is waiting for, so a slow one cannot land last. */
  private _pending = 0;

  constructor() {
    effect(() => {
      const id = this.value();
      if (id === '') {
        this.chosen.set(null);
        return;
      }
      void this._resolve(id);
    });
  }

  ngOnDestroy(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
  }

  startChanging(): void {
    this.changing.set(true);
    this.term.set('');
    void this._search('');
  }

  choose(option: ReferenceOption): void {
    this.chosen.set(option);
    this.changing.set(false);
    this.valueChange.emit(option.id);
  }

  clear(): void {
    this.chosen.set(null);
    this.changing.set(false);
    this.valueChange.emit('');
  }

  onSearch(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.term.set(term);

    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => void this._search(term), SEARCH_DELAY_MS);
  }

  private async _search(term: string): Promise<void> {
    const request = ++this._pending;
    this.searching.set(true);

    try {
      const options = await this.lookup().search(
        this.resource(),
        term,
        this.scope()
      );
      // A search the operator has already typed past must not overwrite a later
      // one that came back first, which is the ordinary case when the second
      // term is more specific and therefore faster.
      if (request === this._pending) {
        this.options.set(options);
      }
    } catch {
      if (request === this._pending) {
        this.options.set([]);
      }
    } finally {
      if (request === this._pending) {
        this.searching.set(false);
      }
    }
  }

  private async _resolve(id: string): Promise<void> {
    this.resolving.set(true);
    try {
      this.chosen.set(await this.lookup().resolve(this.resource(), id));
    } catch {
      this.chosen.set(null);
    } finally {
      this.resolving.set(false);
    }
  }
}
