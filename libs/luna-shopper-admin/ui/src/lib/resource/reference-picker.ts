import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  type OnDestroy,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  REFERENCE_NONE,
  isReferenceNone,
} from '@portfolio/luna-shopper-admin/models';
import { ChevronLeftIcon } from '@portfolio/shared/ui';
import type {
  ReferenceLookup,
  ReferenceOption,
  ReferenceScope,
} from './reference-lookup';

/** How long typing settles before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * The first choice of a list, which clears the value (admin plan 0050).
 *
 * `'none'` reads "None", for a field whose column allows nothing. `'any'` reads
 * "Any", for a filter, where an empty value means every row. `null` offers no
 * such choice: the field can be changed and cannot be emptied.
 */
export type ReferenceEmpty = 'none' | 'any' | null;

/** One line of the open list. */
interface PickerRow {
  /** `''` for the choice that clears, the none literal, or a row's id. */
  readonly id: string;
  readonly kind: 'empty' | 'none' | 'option';
  readonly option: ReferenceOption | null;
}

/**
 * A uuid, chosen by name (plan 0004, section 6; a combobox since plan 0050).
 *
 * One text field with the arrow of a select at its right edge. With a value it
 * shows **what the value points at**, by name. The arrow, a click in the field,
 * an arrow key or typing opens a list under it, and the list holds the first
 * page of the target before anything is typed: an operator who does not know
 * what the options are called can still read them.
 *
 * **A value changes only when an option is chosen.** Text that was typed and
 * not chosen is thrown away when the field is left, and the field shows what
 * it held. Emptying the text clears nothing, because in a form a field cleared
 * by a slip is a saved null.
 *
 * **Two choices can stand before the rows, and only while nothing is typed.**
 * A typed word is a search for a row by name, and neither of these has a name
 * to match.
 *
 * - {@link empty} clears the value. It reads "None" in a form and "Any" in a
 *   filter, and a required field does not offer it.
 * - {@link none} is a filter asking for the rows that point at nothing (plan
 *   0012, section 2). It holds {@link REFERENCE_NONE} as the value, which is
 *   drawn by name like any other choice and is never looked up.
 *
 * A reference whose target no longer exists says so under the field rather
 * than showing an empty box, because those are different problems and only one
 * of them is fixed by picking something.
 *
 * The keyboard and the names a screen reader hears are the combobox pattern
 * with a listbox: the focus stays in the field the whole time, and the active
 * option is named through `aria-activedescendant`.
 */
@Component({
  selector: 'lib-reference-picker',
  imports: [RokuTranslatorPipe, ChevronLeftIcon],
  template: `
    <div class="box">
      <input
        (blur)="leave()"
        (click)="show()"
        (input)="onType($event)"
        (keydown)="onKey($event)"
        [attr.aria-activedescendant]="activeId()"
        [attr.aria-controls]="open() ? listId() : null"
        [attr.aria-describedby]="missing() ? missingId() : null"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="label()"
        [disabled]="disabled()"
        [id]="controlId()"
        [placeholder]="placeholderKey() | rokuT"
        [value]="
          editing()
            ? term()
            : isNone()
              ? ('resource.reference.none' | rokuT)
              : shownTitle()
        "
        aria-autocomplete="list"
        autocapitalize="none"
        autocomplete="off"
        autocorrect="off"
        role="combobox"
        spellcheck="false"
        type="text"
      />
      <!-- Out of the tab order on purpose: the field opens the same list with
           an arrow key, so a second stop would be a second name for one
           control. The press is swallowed so the field keeps the focus. -->
      <button
        (click)="toggle()"
        (mousedown)="$event.preventDefault()"
        [attr.aria-controls]="open() ? listId() : null"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'resource.reference.open' | rokuT"
        [disabled]="disabled()"
        class="arrow"
        tabindex="-1"
        type="button"
        data-arrow
      >
        <lib-chevron-left-icon />
      </button>

      @if (open()) {
        <div (mousedown)="$event.preventDefault()" class="popup">
          <!-- The options take no focus and no key of their own. The field
               holds the focus and its keys move through them, which is what
               aria-activedescendant says to a screen reader. -->
          <!-- eslint-disable @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          <ul [attr.aria-label]="label()" [id]="listId()" role="listbox">
            @for (row of rows(); track row.id; let index = $index) {
              <li
                (click)="pick(row)"
                (mousemove)="active.set(index)"
                [attr.aria-selected]="row.id === value()"
                [class.active]="index === active()"
                [class.quiet]="row.kind !== 'option'"
                [id]="optionId(index)"
                role="option"
              >
                @switch (row.kind) {
                  @case ('empty') {
                    {{ emptyKey() | rokuT }}
                  }
                  @case ('none') {
                    {{ 'resource.reference.none' | rokuT }}
                  }
                  @default {
                    {{ row.option?.title }}
                  }
                }
              </li>
            }
          </ul>
          <!-- eslint-enable @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          @if (searching()) {
            <p class="state" role="status">
              {{ 'resource.reference.searching' | rokuT }}
            </p>
          } @else if (rows().length === 0) {
            <p class="state" role="status">
              {{ 'resource.reference.noResults' | rokuT }}
            </p>
          }
        </div>
      }
    </div>

    @if (missing()) {
      <p [id]="missingId()" class="missing">
        {{ 'resource.reference.missing' | rokuT: { id: value() } }}
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .box {
      position: relative;
    }

    /* The outline, the height and the padding are the global control rule's.
       Only the room for the arrow is added, by the sum the select uses. */
    input {
      inline-size: 100%;
      padding-inline-end: calc(
        var(--admin-space-3) + var(--admin-caret) + var(--admin-space-2)
      );
      text-overflow: ellipsis;
    }

    input::placeholder {
      color: var(--admin-ink-muted);
      opacity: 1;
    }

    /* As wide as the arrow and the space on both sides of it, so the chevron
       sits --admin-space-3 from the edge, where a select draws its own. */
    .arrow {
      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;
      display: grid;
      place-items: center;
      inline-size: calc(var(--admin-caret) + 2 * var(--admin-space-3));
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
      color: var(--admin-ink-muted);
      cursor: pointer;
    }

    /* The shared chevron points back. A quarter turn points it down. */
    .arrow lib-chevron-left-icon {
      inline-size: var(--admin-caret);
      block-size: var(--admin-caret);
      rotate: -90deg;
    }

    .arrow:disabled {
      cursor: default;
    }

    /* Over the page rather than in it: a list in the flow pushed the rows of a
       filter bar down every time it opened. The shadow says it is above. */
    .popup {
      position: absolute;
      inset-inline: 0;
      inset-block-start: calc(100% + var(--admin-space-1));
      z-index: 30;
      max-block-size: 16rem;
      overflow-y: auto;
      scroll-margin-block: var(--admin-space-4);
      border: 1px solid var(--admin-border-strong);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      box-shadow: 0 0.375rem 1rem rgb(20 23 26 / 14%);
    }

    ul {
      list-style: none;
    }

    li {
      display: flex;
      align-items: center;
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      overflow-wrap: anywhere;
      cursor: pointer;
    }

    li.quiet {
      color: var(--admin-ink-muted);
    }

    li[aria-selected='true'] {
      font-weight: 600;
    }

    li.active {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .state {
      padding: var(--admin-control-pad) var(--admin-space-3);
      color: var(--admin-ink-muted);
    }

    .missing {
      color: var(--admin-danger);
    }

    :disabled {
      opacity: 0.55;
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
  /**
   * The choice that clears the value, and how it reads.
   *
   * Off unless a use asks. A use that forgets it gets a field nobody can
   * empty, which somebody notices. The other default lets a required field be
   * saved empty.
   */
  readonly empty = input<ReferenceEmpty>(null);
  /**
   * Whether "none" is a choice here: the rows that point at nothing.
   *
   * Set by a filter over a nullable column and by nothing else. It is not
   * {@link empty}: clearing a filter asks for every row, and this asks for
   * every row that is already empty.
   */
  readonly none = input(false);
  /**
   * The name of the field, for a use whose visible label is not a
   * `<label for>` pointing at {@link controlId}. Already translated.
   */
  readonly label = input<string | null>(null);
  readonly disabled = input(false);

  readonly valueChange = output<string>();

  /** What the operator typed since the list last closed. */
  readonly term = signal('');
  /** Whether the field shows {@link term} rather than the value's name. */
  readonly editing = signal(false);
  readonly open = signal(false);
  readonly options = signal<readonly ReferenceOption[]>([]);
  readonly searching = signal(false);
  readonly resolving = signal(false);
  readonly chosen = signal<ReferenceOption | null>(null);
  /** The index in {@link rows} the keys are on, or `-1` for none. */
  readonly active = signal(-1);

  readonly listId = computed(() => `${this.controlId()}-list`);
  readonly missingId = computed(() => `${this.controlId()}-missing`);

  /** Whether the value held is "none" rather than an id. */
  readonly isNone = computed(() => isReferenceNone(this.value()));

  /** Whether there is typed text. The two leading choices go when there is. */
  readonly typed = computed(() => this.editing() && this.term().trim() !== '');

  /** The name of the value held, or `''` while there is none to show. */
  readonly shownTitle = computed(() => this.chosen()?.title ?? '');

  /** Whether the value points at a row that is not there. */
  readonly missing = computed(
    () =>
      this.value() !== '' &&
      !this.isNone() &&
      !this.resolving() &&
      this.chosen() === null
  );

  readonly emptyKey = computed(() =>
    this.empty() === 'any' ? 'resource.filter.any' : 'resource.reference.none'
  );

  /** What an empty field says: the same words a select beside it would. */
  readonly placeholderKey = computed(() => {
    if (this.resolving()) {
      return 'resource.reference.resolving';
    }
    return this.empty() === null ? 'resource.field.choose' : this.emptyKey();
  });

  /** The open list, top to bottom. */
  readonly rows = computed<readonly PickerRow[]>(() => {
    const rows: PickerRow[] = [];
    if (!this.typed()) {
      if (this.empty() !== null) {
        rows.push({ id: '', kind: 'empty', option: null });
      }
      if (this.none()) {
        rows.push({ id: REFERENCE_NONE, kind: 'none', option: null });
      }
    }
    if (!this.searching()) {
      for (const option of this.options()) {
        rows.push({ id: option.id, kind: 'option', option });
      }
    }
    return rows;
  });

  readonly activeId = computed(() =>
    this.open() && this.active() >= 0 && this.active() < this.rows().length
      ? this.optionId(this.active())
      : null
  );

  private readonly _host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly _injector = inject(Injector);
  /**
   * Every row a list has shown, by id. A value chosen from the list is then
   * named from here, without a second read for a row already in hand.
   */
  private readonly _seen = new Map<string, ReferenceOption>();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  /** The search this component is waiting for, so a slow one cannot land last. */
  private _pending = 0;
  /** The same guard for the read that names the value held. */
  private _resolveRequest = 0;

  constructor() {
    effect(() => {
      const id = this.value();
      const request = ++this._resolveRequest;
      // "None" names nothing, so there is nothing to resolve and nothing to be
      // missing: the template draws it from the value alone.
      if (id === '' || isReferenceNone(id)) {
        this.chosen.set(null);
        this.resolving.set(false);
        return;
      }
      const seen = this._seen.get(id);
      if (seen !== undefined) {
        this.chosen.set(seen);
        this.resolving.set(false);
        return;
      }
      // The name of the value before this one must not stand in the field
      // while the read for this one is out.
      this.chosen.set(null);
      void this._resolve(id, request);
    });

    // A field that is switched off while its list is open closes it.
    effect(() => {
      if (this.disabled() && untracked(this.open)) {
        this.close();
      }
    });
  }

  ngOnDestroy(): void {
    this._clearTimer();
  }

  optionId(index: number): string {
    return `${this.controlId()}-option-${index}`;
  }

  /** Opens the list on the first page, or on what is already typed. */
  show(): void {
    if (this.open() || this.disabled()) {
      return;
    }
    this.open.set(true);
    this.active.set(-1);
    void this._search(this.typed() ? this.term() : '');
    // On a phone the keyboard takes half the screen, and a list that opened
    // under it would be a list nobody saw.
    afterNextRender(
      () => {
        const popup = this._host.nativeElement.querySelector('.popup');
        popup?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this._injector }
    );
  }

  /** The arrow: opens a closed list, closes an open one. */
  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this._host.nativeElement.querySelector('input')?.focus();
    this.show();
  }

  /** Closes the list and throws away text that was not chosen. */
  close(): void {
    this._clearTimer();
    this._pending++;
    this.searching.set(false);
    this.open.set(false);
    this.editing.set(false);
    this.term.set('');
    this.active.set(-1);
  }

  /** The field lost the focus. A press on the list or the arrow never gets here. */
  leave(): void {
    this.close();
  }

  pick(row: PickerRow): void {
    this.close();
    this.valueChange.emit(row.id);
  }

  onType(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.term.set(term);
    this.editing.set(true);
    this.open.set(true);
    this.active.set(-1);
    // A search that is still out answers a text the field no longer holds.
    // Its answer is dropped, and the rows it would replace are hidden until
    // the search for this text lands: Enter on a stale row picks the wrong
    // record.
    this._pending++;
    this.searching.set(true);

    this._clearTimer();
    this._timer = setTimeout(() => void this._search(term), SEARCH_DELAY_MS);
  }

  onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.show();
          return;
        }
        this._move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Enter': {
        if (!this.open()) {
          return;
        }
        // An open list owns Enter, with or without an active option.
        // Otherwise Enter during a search would submit the form the field is
        // in.
        event.preventDefault();
        const row = this.rows()[this.active()];
        if (row !== undefined) {
          this.pick(row);
        }
        return;
      }
      case 'Escape': {
        if (this.open()) {
          // The list is what Escape closes. A dialog or a panel around the
          // field hears the next one.
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
      }
    }
  }

  /** Moves the active option one step, around the ends. */
  private _move(step: 1 | -1): void {
    const count = this.rows().length;
    if (count === 0) {
      return;
    }
    const from = this.active();
    const next =
      from < 0 ? (step === 1 ? 0 : count - 1) : (from + step + count) % count;
    this.active.set(next);
    afterNextRender(
      () => {
        this._host.nativeElement.ownerDocument
          .getElementById(this.optionId(next))
          ?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this._injector }
    );
  }

  /**
   * The options for a term, and the one place this component reads them.
   *
   * An empty term asks for the first page. Whatever else a term can come to
   * mean (admin plan 0051: a record's id) is decided here and nowhere else.
   */
  private _read(term: string): Promise<readonly ReferenceOption[]> {
    return this.lookup().search(this.resource(), term, this.scope());
  }

  private async _search(term: string): Promise<void> {
    const request = ++this._pending;
    this.searching.set(true);

    let options: readonly ReferenceOption[];
    try {
      options = await this._read(term);
    } catch {
      options = [];
    }

    // A search the operator has already typed past must not overwrite a later
    // one that came back first, which is the ordinary case when the second
    // term is more specific and therefore faster.
    if (request !== this._pending) {
      return;
    }
    for (const option of options) {
      this._seen.set(option.id, option);
    }
    this.options.set(options);
    this.searching.set(false);
    this.active.set(this._startAt());
  }

  /**
   * Where the keys start once a list has landed: the first match under a typed
   * word, so Enter takes it, and the value held otherwise.
   */
  private _startAt(): number {
    const rows = this.rows();
    if (this.typed()) {
      return rows.length > 0 ? 0 : -1;
    }
    const held = this.value();
    return held === '' ? -1 : rows.findIndex((row) => row.id === held);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private async _resolve(id: string, request: number): Promise<void> {
    this.resolving.set(true);
    let found: ReferenceOption | null;
    try {
      found = await this.lookup().resolve(this.resource(), id);
    } catch {
      found = null;
    }
    // A read for a value the field no longer holds answers nothing here: the
    // value that replaced it has its own read, or needed none.
    if (request !== this._resolveRequest) {
      return;
    }
    this.chosen.set(found);
    this.resolving.set(false);
  }
}
